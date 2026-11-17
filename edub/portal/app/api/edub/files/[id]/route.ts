import { bodyOf, json } from "@/lib/api.ts";
import { patchFile, trashFile } from "@/lib/projects.ts";
import { withFile } from "@/lib/route-guards.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export const GET = (req: Request, { params }: Ctx) =>
  withFile(req, params, {}, async (_me, { file, project, role }) =>
    json({ ok: true, file: { id: file.id, name: file.name, tenantId: file.tenantId, folderId: file.folderId, screenCount: file.screenCount, project: project.slug }, role }),
  );

/** Rename / move: `{name?, folderId?}`; restore from trash: `{restore:true}`. */
export const PATCH = (req: Request, { params }: Ctx) =>
  withFile(req, params, { write: true }, async (me, { file, project }) => {
    const b = await bodyOf(req);
    if (b.restore === true) await trashFile(me, project, file, true);
    else await patchFile(me, project, file, b);
    return json({ ok: true });
  });

/** Move to the trash (purged after 30 days). */
export const DELETE = (req: Request, { params }: Ctx) =>
  withFile(req, params, { write: true }, async (me, { file, project }) => {
    await trashFile(me, project, file);
    return json({ ok: true });
  });
