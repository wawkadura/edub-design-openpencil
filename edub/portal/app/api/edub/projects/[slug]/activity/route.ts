import { projectForIdentity } from "@/lib/access.ts";
import { handle, json, notFound } from "@/lib/api.ts";
import { listActivity } from "@/lib/projects.ts";

export const dynamic = "force-dynamic";

export const GET = (req: Request, { params }: { params: Promise<{ slug: string }> }) =>
  handle(req, async (me) => {
    const access = await projectForIdentity(me, (await params).slug);
    if (!access) return notFound();
    const items = await listActivity(access.project.id, 200);
    return json({ ok: true, activity: items.map((a) => ({ actor: a.actor, action: a.action, targetKind: a.targetKind, targetName: a.targetName, meta: a.meta, at: a.createdAt })) });
  });
