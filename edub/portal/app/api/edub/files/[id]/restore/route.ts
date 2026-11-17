import { bodyOf, json } from "@/lib/api.ts";
import { HttpError, restoreVersion } from "@/lib/projects.ts";
import { withFile } from "@/lib/route-guards.ts";

export const dynamic = "force-dynamic";

/** `{sha}` → that version becomes the live document again (as a new commit). */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withFile(req, params, { write: true }, async (me, { file, project }) => {
    const { sha } = await bodyOf(req);
    if (typeof sha !== "string") throw new HttpError(400, "sha requis");
    return json({ ok: true, sha: await restoreVersion(me, project, file, sha) });
  });
