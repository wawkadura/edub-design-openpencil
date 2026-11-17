import { HttpError } from "./projects.ts";
import { MAX_IMAGE_BYTES } from "./screens-model.ts";

export type UploadInput = { filename: string; mime: string | undefined; data: Buffer };
export type ScreenInput = { fields: Record<string, unknown>; upload: UploadInput | null };

/**
 * Body of a gallery write, in either shape (agents use both):
 *  - multipart/form-data: part `file` + text fields;
 *  - JSON with the file inline: `{ filename, contentBase64 | dataBase64, mime?, ...fields }` (a `data:` URL prefix is accepted).
 */
export async function readScreenInput(req: Request): Promise<ScreenInput> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.startsWith("multipart/form-data")) {
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "multipart invalide");
    });
    const fields: Record<string, unknown> = {};
    let upload: UploadInput | null = null;
    for (const [k, v] of form.entries()) {
      if (v instanceof File) {
        if (k === "file") {
          if (v.size > MAX_IMAGE_BYTES) throw new HttpError(413, "fichier trop gros");
          upload = { filename: v.name || "upload", mime: v.type || undefined, data: Buffer.from(await v.arrayBuffer()) };
        }
      } else if (k === "tags" || k === "links") {
        // repeated parts or a JSON array
        const prev = fields[k];
        const parsed = k === "links" && v.trim().startsWith("[") ? safeJson(v) : v;
        fields[k] = Array.isArray(parsed) ? parsed : prev ? [...(prev as unknown[]), parsed] : k === "tags" ? parsed : [parsed];
      } else fields[k] = v;
    }
    return { fields, upload };
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "JSON invalide");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "corps invalide");
  const fields = { ...(body as Record<string, unknown>) };
  const b64 = fields.contentBase64 ?? fields.dataBase64;
  delete fields.contentBase64;
  delete fields.dataBase64;
  let upload: UploadInput | null = null;
  if (typeof b64 === "string" && b64) {
    const m = /^data:([^;,]+)?(?:;[^,]*)?;base64,/i.exec(b64);
    const raw = m ? b64.slice(m[0].length) : b64;
    if (raw.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) throw new HttpError(413, "fichier trop gros");
    const data = Buffer.from(raw, "base64");
    const filename = typeof fields.filename === "string" && fields.filename ? fields.filename : "upload";
    upload = { filename, mime: typeof fields.mime === "string" ? fields.mime : m?.[1], data };
  }
  return { fields, upload };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
