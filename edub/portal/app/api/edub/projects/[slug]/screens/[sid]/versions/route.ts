import { json } from "@/lib/api.ts";
import { addVersion } from "@/lib/screens.ts";
import { readScreenInput } from "@/lib/screens-input.ts";
import { versionJson, withScreen } from "@/lib/screens-route.ts";

export const dynamic = "force-dynamic";

/** New version of the screen (multipart `file` or JSON `contentBase64`; optional `note`). */
export const POST = (req: Request, { params }: { params: Promise<{ slug: string; sid: string }> }) =>
  withScreen(req, params, { write: true }, async (me, { project }, s) => {
    const { fields, upload } = await readScreenInput(req);
    return json({ ok: true, version: versionJson(project, s, await addVersion(me, project, s, fields, upload)) }, 201);
  });
