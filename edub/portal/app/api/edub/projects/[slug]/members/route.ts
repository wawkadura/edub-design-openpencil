import { membersOf, projectForIdentity } from "@/lib/access.ts";
import { bodyOf, handle, json, notFound } from "@/lib/api.ts";
import type { Identity } from "@/lib/identity.ts";
import { HttpError, removeMember, setMember } from "@/lib/projects.ts";
import { canManage, parsePrincipal } from "@/lib/rights.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

type Access = NonNullable<Awaited<ReturnType<typeof projectForIdentity>>>;
function managed(req: Request, ctx: Ctx, fn: (me: Identity, access: Access) => Promise<Response>) {
  return handle(req, async (me) => {
    const access = await projectForIdentity(me, (await ctx.params).slug);
    if (!access) return notFound();
    if (!canManage(access.role)) throw new HttpError(403, "réservé au propriétaire");
    return fn(me, access);
  });
}

export const GET = (req: Request, ctx: Ctx) =>
  managed(req, ctx, async (_me, { project }) => {
    const members = await membersOf(project.id);
    return json({ ok: true, members: members.map((m) => ({ kind: m.principalKind, principal: m.principal, role: m.role })) });
  });

const ROLES = ["owner", "editor", "viewer"] as const;
function parseGrant(body: Record<string, unknown>) {
  const kind = body.kind === "group" ? "group" : body.kind === "user" ? "user" : null;
  const principal = parsePrincipal(body.principal);
  const role = ROLES.find((r) => r === body.role);
  if (!kind || !principal || !role) throw new HttpError(400, "kind, principal ou role invalide");
  return { kind, principal, role } as const;
}

/** Add or change a member: `{kind:'user'|'group', principal, role}`. */
export const POST = (req: Request, ctx: Ctx) =>
  managed(req, ctx, async (me, { project }) => {
    const g = parseGrant(await bodyOf(req));
    await setMember(me, project, g.kind, g.principal, g.role);
    return json({ ok: true });
  });

export const DELETE = (req: Request, ctx: Ctx) =>
  managed(req, ctx, async (me, { project }) => {
    const body = await bodyOf(req);
    const kind = body.kind === "group" ? "group" : body.kind === "user" ? "user" : null;
    const principal = parsePrincipal(body.principal);
    if (!kind || !principal) throw new HttpError(400, "kind ou principal invalide");
    await removeMember(me, project, kind, principal);
    return json({ ok: true });
  });
