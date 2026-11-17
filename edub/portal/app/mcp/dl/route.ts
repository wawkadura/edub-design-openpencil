import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb, schema } from "@/lib/db/index.ts";
import { and, eq } from "drizzle-orm";
import { env } from "@/lib/env.ts";
import { verifyDownload } from "@/lib/mcp/signed.ts";
import { fileHeaders } from "@/lib/screens-route.ts";
import { getScreen, versionBytes } from "@/lib/screens.ts";

/** Signed short links handed out by the MCP (`get_screen as=url`, `export_frame as=url`). */
export const dynamic = "force-dynamic";

const gone = () => new Response("not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  const sp = new URL(req.url).searchParams;
  const target = verifyDownload(env.tokenSecret, sp.get("k") ?? "", sp.get("s") ?? "");
  if (!target) return gone();
  if (target.t === "export") {
    if (!/^[0-9a-f]{24}$/.test(target.id) || !/^(png|jpg|webp)$/.test(target.ext)) return gone();
    try {
      const bytes = await readFile(path.join(env.projectsDir, ".mcp-exports", `${target.id}.${target.ext}`));
      const mime = target.ext === "jpg" ? "image/jpeg" : `image/${target.ext}`;
      return new Response(new Uint8Array(bytes), { headers: { "content-type": mime, "cache-control": "private, max-age=600", "x-content-type-options": "nosniff", "content-security-policy": "sandbox; default-src 'none'" } });
    } catch {
      return gone();
    }
  }
  const [project] = await getDb().select().from(schema.projects).where(and(eq(schema.projects.slug, target.p), eq(schema.projects.archived, false)));
  if (!project) return gone();
  const screen = await getScreen(project, target.s);
  const v = screen?.versions.find((x) => x.n === target.n);
  if (!screen || !v) return gone();
  return new Response(new Uint8Array(await versionBytes(project, screen, v)), { headers: fileHeaders(v, true) });
}
