import { json, bodyOf } from "@/lib/api.ts";
import { createFile, HttpError } from "@/lib/projects.ts";
import { withProject } from "@/lib/route-guards.ts";

export const dynamic = "force-dynamic";
const MAX_IMPORT = 45 * 1024 * 1024;

/**
 * New file. JSON `{name, folderId?}` → empty document; multipart `file` (+ `name?`, `folderId?`)
 * → import of a `.op` / `.pen` (JSON) or `.fig` (converted by the editor host).
 */
export const POST = (req: Request, { params }: { params: Promise<{ slug: string }> }) =>
  withProject(req, params, { write: true }, async (me, { project }) => {
    const ct = req.headers.get("content-type") ?? "";
    let file;
    if (ct.startsWith("multipart/form-data")) {
      const form = await req.formData();
      const upload = form.get("file");
      if (!(upload instanceof File)) throw new HttpError(400, "fichier requis");
      if (upload.size > MAX_IMPORT) throw new HttpError(413, "fichier trop gros");
      const base = upload.name.replace(/\.(op|pen|fig)$/i, "") || "Import";
      const name = typeof form.get("name") === "string" && form.get("name") ? form.get("name") : base;
      const folderId = form.get("folderId") || undefined;
      const bytes = Buffer.from(await upload.arrayBuffer());
      file = /\.fig$/i.test(upload.name)
        ? await createFile(me, project, { name, folderId, fig: { name: upload.name, bytes } })
        : await createFile(me, project, { name, folderId, document: bytes.toString("utf8") });
    } else {
      const b = await bodyOf(req);
      file = await createFile(me, project, { name: b.name, folderId: b.folderId });
    }
    return json({ ok: true, file: { id: file.id, name: file.name } }, 201);
  });
