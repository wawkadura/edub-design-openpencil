import { json } from "@/lib/api.ts";
import { duplicateFile } from "@/lib/projects.ts";
import { withFile } from "@/lib/route-guards.ts";

export const dynamic = "force-dynamic";

export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  withFile(req, params, { write: true }, async (me, { file, project }) => {
    const copy = await duplicateFile(me, project, file);
    return json({ ok: true, file: { id: copy.id, name: copy.name } }, 201);
  });
