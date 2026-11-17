import { mintEditorToken } from "./editor-token.ts";
import { env } from "./env.ts";

/**
 * Loopback client of the Rust editor host, acting for one design file (= tenant).
 * Same per-file Bearer as the nginx gate injects; the host introspects it at the portal.
 * Used to snapshot a document into git, restore a version, and render thumbnails.
 */
async function call(tenant: string, username: string, method: string, path: string, body?: string): Promise<Response> {
  const token = mintEditorToken(env.tokenSecret, tenant, username);
  return fetch(`${env.editorUrl}${path}?tenant=${tenant}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body,
    signal: AbortSignal.timeout(30_000),
  });
}

/** Live `.op` document JSON of the tenant (loads it from disk if not resident). */
export async function fetchDocument(tenant: string, username: string): Promise<string> {
  const res = await call(tenant, username, "GET", "/api/mcp/document");
  if (!res.ok) throw new Error(`editor document read failed (${res.status})`);
  const parsed = JSON.parse(await res.text()) as { document?: unknown };
  if (!parsed.document) throw new Error("editor returned no document");
  return JSON.stringify(parsed.document);
}

/** Replace the live document (open tabs follow through the host's SSE). */
export async function pushDocument(tenant: string, username: string, documentJson: string): Promise<void> {
  const res = await call(tenant, username, "POST", "/api/mcp/document", `{"document":${documentJson}}`);
  if (!res.ok) throw new Error(`editor document push failed (${res.status})`);
}

/** PNG of the active page, rendered by the host (`/api/export/raster`). */
export async function renderPng(tenant: string, username: string, documentJson: string, scale = 0.25): Promise<Buffer> {
  const res = await call(tenant, username, "POST", "/api/export/raster", `{"format":"png","scale":${scale},"document":${documentJson}}`);
  if (!res.ok) throw new Error(`editor export failed (${res.status})`);
  const out = (await res.json()) as { dataBase64?: string };
  if (!out.dataBase64) throw new Error("editor export returned no image");
  return Buffer.from(out.dataBase64, "base64");
}

/** `.fig` bytes → `.op` document JSON via the host's offline converter. */
export async function convertFig(tenant: string, username: string, name: string, bytes: Buffer): Promise<string> {
  const res = await call(tenant, username, "POST", "/api/figma/convert", JSON.stringify({ name, bytesB64: bytes.toString("base64") }));
  const text = await res.text();
  if (!res.ok) throw new Error(`conversion .fig impossible (${res.status})`);
  const out = JSON.parse(text) as { ok?: boolean; doc?: unknown; error?: string };
  if (!out.ok || !out.doc) throw new Error(out.error ?? "conversion .fig impossible");
  return JSON.stringify(out.doc);
}

/** Top-level frames across pages = "screens". */
export function countScreens(documentJson: string): number {
  try {
    const d = JSON.parse(documentJson) as { children?: { type?: string }[]; pages?: { children?: { type?: string }[] }[] };
    const lists = d.pages ? d.pages.map((p) => p.children ?? []) : [d.children ?? []];
    return lists.flat().filter((n) => n?.type === "frame").length;
  } catch {
    return 0;
  }
}

export function isOpDocument(documentJson: string): boolean {
  try {
    const d = JSON.parse(documentJson) as { version?: unknown; children?: unknown; pages?: unknown };
    return typeof d.version === "string" && (Array.isArray(d.children) || Array.isArray(d.pages));
  } catch {
    return false;
  }
}

export const EMPTY_DOCUMENT = JSON.stringify({
  version: "1.1",
  children: [{ type: "frame", id: "n1", name: "Écran 1", x: 0, y: 0, width: 390, height: 844, fill: [{ type: "solid", color: "#FFFFFF" }], children: [] }],
  editorMeta: { activePageIndex: 0, preserveAuthoredGeometry: false },
});
