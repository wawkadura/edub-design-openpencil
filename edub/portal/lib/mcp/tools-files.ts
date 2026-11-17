import { and, eq, isNull } from "drizzle-orm";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { getDb, schema } from "../db/index.ts";
import type { DesignFile, Project } from "../db/schema.ts";
import { fetchDocument, isOpDocument } from "../editor-client.ts";
import { env } from "../env.ts";
import { createFile, listFiles, snapshotFile, versionsOf } from "../projects.ts";
import { readHead } from "../versioning.ts";
import { isUuid } from "../screens.ts";
import { hostTool, hostText } from "./host.ts";
import { PROXIED, proxySchema } from "./design-proxy.ts";
import { signDownload } from "./signed.ts";
import { json, needProject, num, PROJECT_ARG, str, text, ToolError, withImage, type Tool, type ToolCtx, type ToolResult } from "./kit.ts";

const MAX_JSON_CHARS = 600_000;

async function needFile(project: Project, fileId: unknown): Promise<DesignFile> {
  if (!isUuid(fileId)) throw new ToolError(`file "${String(fileId)}" not found in project "${project.slug}"`);
  const [f] = await getDb()
    .select()
    .from(schema.designFiles)
    .where(and(eq(schema.designFiles.id, fileId), eq(schema.designFiles.projectId, project.id), isNull(schema.designFiles.trashedAt), eq(schema.designFiles.archived, false)))
    .limit(1);
  if (!f) throw new ToolError(`file "${fileId}" not found in project "${project.slug}"`);
  return f;
}

/** Live document (the editor may hold unsaved-to-git edits), else the last committed one. */
async function currentDocument(file: DesignFile, project: Project, who: string): Promise<string> {
  try {
    return await fetchDocument(file.tenantId, who);
  } catch {
    const head = await readHead(env.projectsDir, project.slug, file.id);
    if (!head) throw new ToolError("this file has no content yet");
    return head;
  }
}

type Node = { type?: string; id?: string; name?: string; width?: number; height?: number; children?: Node[] };
function summarize(documentJson: string) {
  const d = JSON.parse(documentJson) as { version?: string; children?: Node[]; pages?: { id?: string; name?: string; children?: Node[] }[] };
  const pages = d.pages ?? [{ name: "Page 1", id: undefined, children: d.children }];
  const count = (n: Node): number => 1 + (n.children ?? []).reduce((a, c) => a + count(c), 0);
  return {
    version: d.version,
    pages: pages.map((p) => ({
      id: p.id,
      name: p.name,
      topLevel: (p.children ?? []).map((n) => ({ id: n.id, type: n.type, name: n.name, width: n.width, height: n.height, nodes: count(n) })),
    })),
  };
}

function proxyTool(spec: (typeof PROXIED)[number]): Tool {
  return {
    name: spec.name,
    description: spec.description,
    write: spec.write,
    inputSchema: proxySchema(spec),
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, spec.write);
      const file = await needFile(project, args.file);
      const forward: Record<string, unknown> = { ...args };
      delete forward.project;
      delete forward.file;
      delete forward.filePath; // never let an agent point the editor at a server path
      const res = await hostTool(file.tenantId, ctx.actor.username, spec.name, forward);
      const out: ToolResult = { content: res.content, isError: res.isError };
      if (spec.write && !res.isError) {
        const snap = await snapshotFile(file, project, ctx.actor.username, `${ctx.actor.username} : ${spec.name}`).catch((e) => {
          throw new ToolError(`design applied but saving the version failed: ${e instanceof Error ? e.message : e}`);
        });
        out.content = [...res.content, { type: "text", text: JSON.stringify({ saved: true, commit: snap.sha ? snap.sha.slice(0, 8) : "unchanged" }) }];
      }
      return out;
    },
  };
}

const exportsDir = () => path.join(env.projectsDir, ".mcp-exports");
/** Signed export links live 10 minutes: drop files older than an hour. */
async function sweepExports(): Promise<void> {
  const dir = exportsDir();
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const st = await stat(path.join(dir, f)).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 3_600_000) await rm(path.join(dir, f), { force: true });
  }
}

export const fileTools: Tool[] = [
  {
    name: "list_files",
    description: "List the design files (.op) of a project: id, name, number of screens (top-level frames), last update.",
    inputSchema: { type: "object", properties: { project: PROJECT_ARG }, required: ["project"] },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, false);
      const files = await listFiles(project.id);
      return json({ files: files.map((f) => ({ id: f.id, name: f.name, folderId: f.folderId, screenCount: f.screenCount, updatedAt: f.updatedAt })) });
    },
  },
  {
    name: "read_file",
    description: "Read a design file. format=summary (default): pages and top-level frames with ids, sizes and node counts. format=json: the full .op document (large; may be refused above ~600 KB — use batch_get instead). Add history=true to list the saved versions.",
    inputSchema: {
      type: "object",
      properties: { project: PROJECT_ARG, file: { type: "string", description: "Design file id." }, format: { type: "string", enum: ["summary", "json"] }, history: { type: "boolean", description: "Also list the last git versions." } },
      required: ["project", "file"],
    },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, false);
      const file = await needFile(project, args.file);
      const format = str(args, "format") ?? "summary";
      if (format !== "summary" && format !== "json") throw new ToolError('format must be "summary" or "json"');
      const doc = await currentDocument(file, project, ctx.actor.username);
      const history = args.history === true ? (await versionsOf(project, file)).slice(0, 20) : undefined;
      if (format === "json") {
        if (doc.length > MAX_JSON_CHARS) throw new ToolError(`document is ${doc.length} characters: too large for format=json, use format=summary then batch_get`);
        return text(history ? JSON.stringify({ history, document: JSON.parse(doc) }) : doc);
      }
      return json({ id: file.id, name: file.name, ...summarize(doc), ...(history ? { history } : {}) });
    },
  },
  {
    name: "create_file",
    description: "Create a design file (.op) in a project. Starts with one empty 390x844 frame unless `document` (a .op JSON string) is given. The creation is committed to the project's git history under the token's name.",
    write: true,
    inputSchema: {
      type: "object",
      properties: { project: PROJECT_ARG, name: { type: "string", description: "File name (max 120 chars)." }, document: { type: "string", description: "Optional .op / .pen document as a JSON string." } },
      required: ["project", "name"],
    },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, true);
      const doc = str(args, "document");
      if (doc && doc.length > MAX_UPLOAD_CHARS) throw new ToolError("document too large");
      const file = await createFile(ctx.actor, project, { name: str(args, "name", true), ...(doc ? { document: doc } : {}) });
      return json({ id: file.id, name: file.name, project: project.slug, screenCount: file.screenCount });
    },
  },
  ...PROXIED.map(proxyTool),
  {
    name: "export_frame",
    description: "Render a frame (or any node) of a stored .op file to an image. Returns it as an MCP image, or with as=url a signed link valid 10 minutes. Formats: png, jpeg, webp (SVG is not available).",
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT_ARG,
        file: { type: "string", description: "Design file id." },
        nodeId: { type: "string", description: "Frame / node id (see read_file summary)." },
        format: { type: "string", enum: ["png", "jpeg", "webp"] },
        scale: { type: "number", description: "Pixel ratio, 0.1 to 4 (default 1)." },
        as: { type: "string", enum: ["image", "url"], description: "image (default) = inline MCP image; url = signed download link." },
      },
      required: ["project", "file", "nodeId"],
    },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, false);
      const file = await needFile(project, args.file);
      const format = str(args, "format") ?? "png";
      if (!["png", "jpeg", "webp"].includes(format)) throw new ToolError("format must be png, jpeg or webp (svg is not available)");
      const scale = Math.min(4, Math.max(0.1, num(args, "scale") ?? 1));
      const as = str(args, "as") ?? "image";
      if (as !== "image" && as !== "url") throw new ToolError('as must be "image" or "url"');
      const nodeId = str(args, "nodeId", true)!;
      // Make sure the editor holds the committed document (a brand-new file has never been opened).
      const res = await hostTool(file.tenantId, ctx.actor.username, "export_nodes", { nodeIds: [nodeId], format, scale });
      if (res.isError) throw new ToolError(hostText(res) || "export failed");
      const bytes = extractExport(res);
      if (!bytes) throw new ToolError(`could not render node "${nodeId}": ${hostText(res).slice(0, 200)}`);
      const mime = `image/${format}`;
      if (as === "image") return withImage({ project: project.slug, file: file.id, nodeId, format, bytes: bytes.length }, bytes, mime);
      const id = randomBytes(12).toString("hex");
      const ext = format === "jpeg" ? "jpg" : format;
      await mkdir(exportsDir(), { recursive: true, mode: 0o700 });
      await sweepExports();
      await writeFile(path.join(exportsDir(), `${id}.${ext}`), bytes, { mode: 0o600 });
      const sig = signDownload(env.tokenSecret, { t: "export", id, ext });
      return json({ url: `${ctx.origin}/mcp/dl?k=${sig.k}&s=${sig.s}`, expiresInSeconds: 600, mime, bytes: bytes.length });
    },
  },
  {
    name: "export_code",
    description: "Export frames of a stored .op file as source code, deterministically (op-codegen, no model). framework: react-tailwind (default), react, vue, svelte, html, flutter, swiftui, compose, react-native, css-variables.",
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT_ARG,
        file: { type: "string", description: "Design file id." },
        framework: { type: "string", enum: ["react", "react-tailwind", "vue", "svelte", "html", "flutter", "swiftui", "compose", "react-native", "css-variables"] },
        nodeIds: { type: "array", items: { type: "string" }, description: "Optional node ids to export." },
        pageId: { type: "string", description: "Optional page whose top-level nodes to export." },
      },
      required: ["project", "file"],
    },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, false);
      const file = await needFile(project, args.file);
      const forward: Record<string, unknown> = {};
      if (args.framework) forward.framework = str(args, "framework");
      if (Array.isArray(args.nodeIds)) forward.nodeIds = JSON.stringify(args.nodeIds);
      if (args.pageId) forward.pageId = str(args, "pageId");
      const res = await hostTool(file.tenantId, ctx.actor.username, "codegen_export", forward);
      return { content: res.content, isError: res.isError };
    },
  },
];

const MAX_UPLOAD_CHARS = 8 * 1024 * 1024;

/** `export_nodes` answers JSON text with base64 bytes; accept the shapes the host may use. */
function extractExport(res: Awaited<ReturnType<typeof hostTool>>): Buffer | null {
  for (const c of res.content) {
    if (c.type === "image") return Buffer.from(c.data, "base64");
    try {
      const v = JSON.parse(c.text) as unknown;
      const found = findBase64(v);
      if (found) return Buffer.from(found, "base64");
    } catch {
      /* not json */
    }
  }
  return null;
}
function findBase64(v: unknown): string | null {
  if (!v || typeof v !== "object") return null;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (typeof x === "string" && /base64|^data$/i.test(k) && x.length > 40) return x;
    const deep = findBase64(x);
    if (deep) return deep;
  }
  return null;
}

export type { ToolCtx };
