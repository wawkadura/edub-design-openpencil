import { json } from "@/lib/api.ts";
import { snapshotFile, versionsOf } from "@/lib/projects.ts";
import { withFile } from "@/lib/route-guards.ts";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** History of the file, newest first (git log: sha, author, date, message). */
export const GET = (req: Request, { params }: Ctx) =>
  withFile(req, params, {}, async (_me, { file, project }) => json({ ok: true, versions: await versionsOf(project, file) }));

/** Save a version now: commit the live document (no-op when unchanged). */
export const POST = (req: Request, { params }: Ctx) =>
  withFile(req, params, { write: true }, async (me, { file, project }) => {
    const r = await snapshotFile(file, project, me.username, `version manuelle : ${file.name}`);
    return json({ ok: true, sha: r.sha, unchanged: r.sha === null });
  });
