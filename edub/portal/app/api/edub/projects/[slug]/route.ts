import { membersOf, projectForIdentity } from "@/lib/access.ts";
import { bodyOf, handle, json, notFound } from "@/lib/api.ts";
import { folderTree, HttpError, listFiles, purgeExpired, updateProject } from "@/lib/projects.ts";
import { canManage } from "@/lib/rights.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

export const GET = (req: Request, { params }: Ctx) =>
  handle(req, async (me) => {
    const access = await projectForIdentity(me, (await params).slug);
    if (!access) return notFound();
    const { project, role } = access;
    await purgeExpired(project);
    const trash = new URL(req.url).searchParams.get("trash") === "1";
    const [files, folders, members] = await Promise.all([listFiles(project.id, { trash }), folderTree(project.id), membersOf(project.id)]);
    return json({
      ok: true,
      project: { slug: project.slug, name: project.name, emoji: project.emoji, color: project.color, description: project.description, archived: project.archived },
      role,
      folders: folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId })),
      files: files.map((f) => ({ id: f.id, tenantId: f.tenantId, name: f.name, folderId: f.folderId, screenCount: f.screenCount, updatedAt: f.updatedAt, trashedAt: f.trashedAt })),
      // Who has access is only shown to people who manage it.
      members: canManage(role) ? members.map((m) => ({ kind: m.principalKind, principal: m.principal, role: m.role })) : undefined,
    });
  });

export const PATCH = (req: Request, { params }: Ctx) =>
  handle(req, async (me) => {
    const access = await projectForIdentity(me, (await params).slug);
    if (!access) return notFound();
    if (!canManage(access.role)) throw new HttpError(403, "réservé au propriétaire");
    const project = await updateProject(me, access.project, await bodyOf(req));
    return json({ ok: true, project: { slug: project.slug, name: project.name, archived: project.archived } });
  });

export const DELETE = (req: Request, ctx: Ctx) =>
  handle(req, async (me) => {
    const access = await projectForIdentity(me, (await ctx.params).slug);
    if (!access) return notFound();
    if (!canManage(access.role)) throw new HttpError(403, "réservé au propriétaire");
    await updateProject(me, access.project, { archived: true });
    return json({ ok: true });
  });
