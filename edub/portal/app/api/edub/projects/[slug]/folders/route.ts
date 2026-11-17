import { bodyOf, json } from "@/lib/api.ts";
import { createFolder, deleteFolder, HttpError, renameFolder } from "@/lib/projects.ts";
import { withProject } from "@/lib/route-guards.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ slug: string }> };

export const POST = (req: Request, { params }: Ctx) =>
  withProject(req, params, { write: true }, async (me, { project }) => {
    const b = await bodyOf(req);
    const f = await createFolder(me, project, b.name, b.parentId);
    return json({ ok: true, folder: { id: f.id, name: f.name, parentId: f.parentId } }, 201);
  });

export const PATCH = (req: Request, { params }: Ctx) =>
  withProject(req, params, { write: true }, async (me, { project }) => {
    const b = await bodyOf(req);
    if (typeof b.id !== "string") throw new HttpError(400, "id requis");
    await renameFolder(me, project, b.id, b.name);
    return json({ ok: true });
  });

export const DELETE = (req: Request, { params }: Ctx) =>
  withProject(req, params, { write: true }, async (me, { project }) => {
    const b = await bodyOf(req);
    if (typeof b.id !== "string") throw new HttpError(400, "id requis");
    await deleteFolder(me, project, b.id);
    return json({ ok: true });
  });
