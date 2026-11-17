import { and, eq, ilike } from "drizzle-orm";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { getDb, schema } from "../db/index.ts";
import type { Project, Screen } from "../db/schema.ts";
import { env } from "../env.ts";
import { addComment, addVersion, createScreen, getScreen, isUuid, listComments, listScreens, listSections, thumbBytes, updateScreen, versionBytes } from "../screens.ts";
import { MAX_HTML_BYTES, PLATFORMS, STATUSES } from "../screens-model.ts";
import { screenJson, versionJson } from "../screens-route.ts";
import type { UploadInput } from "../screens-input.ts";
import { signDownload } from "./signed.ts";
import { json, MAX_UPLOAD_BYTES, needProject, num, PROJECT_ARG, str, text, ToolError, withImage, type Tool, type ToolCtx } from "./kit.ts";

/** Roots a `path` upload may read from (default: the system temp dirs). Colon-separated env override. */
const pathRoots = () => (process.env.EDUB_DESIGN_MCP_PATH_ROOTS ?? "/tmp:/var/tmp").split(":").filter(Boolean);

/**
 * Read an upload from a local path, anti path-traversal: the REAL path (symlinks resolved) must sit
 * inside an allowed root, be a regular file, not a dotfile / dot-directory, and stay under the size cap.
 */
export async function readLocalUpload(raw: string, maxBytes: number): Promise<UploadInput> {
  if (!path.isAbsolute(raw)) throw new ToolError("path must be absolute");
  let real: string;
  try {
    real = await realpath(raw);
  } catch {
    throw new ToolError(`file not readable: ${raw}`);
  }
  const roots = await Promise.all(pathRoots().map((r) => realpath(r).catch(() => null)));
  const inside = roots.some((r) => r && (real === r || real.startsWith(r.endsWith("/") ? r : `${r}/`)));
  if (!inside) throw new ToolError(`path outside the allowed upload folders (${pathRoots().join(", ")}): send the bytes with imageBase64 instead`);
  if (real.split("/").some((seg) => seg.startsWith("."))) throw new ToolError("hidden files and folders are not readable");
  const st = await lstat(real);
  if (!st.isFile()) throw new ToolError("path is not a regular file");
  if (st.size > maxBytes) throw new ToolError(`file is ${st.size} bytes, limit is ${maxBytes}`);
  const fh = await open(real, "r");
  try {
    return { filename: path.basename(real), mime: undefined, data: await fh.readFile() };
  } finally {
    await fh.close();
  }
}

function base64Upload(b64: string, filename: string | undefined, maxBytes: number, mime?: string): UploadInput {
  const m = /^data:([^;,]+)?(?:;[^,]*)?;base64,/i.exec(b64);
  const raw = m ? b64.slice(m[0].length) : b64;
  if (raw.length > Math.ceil((maxBytes * 4) / 3) + 8) throw new ToolError(`file too large (limit ${maxBytes} bytes)`);
  const data = Buffer.from(raw, "base64");
  if (data.length === 0) throw new ToolError("empty file");
  return { filename: filename ?? "upload", mime: mime ?? m?.[1], data };
}

async function resolveSection(project: Project, ref: string): Promise<string> {
  const sections = await listSections(project.id);
  const hit = /^[0-9a-f-]{36}$/.test(ref) ? sections.find((s) => s.id === ref) : sections.find((s) => s.name.toLowerCase() === ref.trim().toLowerCase());
  if (!hit) throw new ToolError(`section "${ref}" not found in project "${project.slug}" (known: ${sections.map((s) => s.name).join(", ") || "none"})`);
  return hit.id;
}

async function needScreen(project: Project, id: unknown) {
  const s = isUuid(id) ? await getScreen(project, id) : null;
  if (!s) throw new ToolError(`screen "${String(id)}" not found in project "${project.slug}"`);
  return s;
}

/** Shared metadata arguments of add_screen / add_html_mockup / update_screen → gallery fields. */
async function metaFields(project: Project, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const f: Record<string, unknown> = {};
  for (const k of ["title", "platform", "status", "description"] as const) if (args[k] !== undefined) f[k] = args[k];
  if (args.tags !== undefined) f.tags = args.tags;
  const links: unknown[] = [];
  if (Array.isArray(args.tickets)) links.push(...args.tickets);
  if (Array.isArray(args.links)) links.push(...args.links);
  if (links.length || args.tickets !== undefined || args.links !== undefined) f.links = links;
  const section = str(args, "section");
  if (section) f.sectionId = await resolveSection(project, section);
  return f;
}

const META_PROPS = {
  title: { type: "string", description: "Screen title (max 160 chars)." },
  section: { type: "string", description: "Section name or id (see list_sections)." },
  platform: { type: "string", enum: [...PLATFORMS], description: "Platform of the screen." },
  status: { type: "string", enum: [...STATUSES] },
  tags: { type: "array", items: { type: "string" } },
  description: { type: "string", description: "Markdown description." },
  tickets: { type: "array", items: { type: "string" }, description: 'Linked tickets, e.g. ["ED_1234"].' },
  links: { type: "array", items: {}, description: "Other links: URLs or {type, url|ref, label}." },
} as const;

/** Create the screen, or add a version when `screen` (id) is given or a screen with the same title+platform exists. */
async function upsertScreen(ctx: ToolCtx, args: Record<string, unknown>, upload: UploadInput): Promise<ReturnType<typeof json>> {
  const { project } = await needProject(ctx, args, true);
  const fields: Record<string, unknown> = { ...(await metaFields(project, args)), agent: ctx.token.label };
  let existing: Screen | null = null;
  if (args.screen !== undefined) existing = await needScreen(project, args.screen);
  else if (typeof args.title === "string" && args.title.trim()) {
    const platform = typeof args.platform === "string" ? args.platform.toLowerCase() : null;
    const rows = await getDb()
      .select()
      .from(schema.screens)
      .where(and(eq(schema.screens.projectId, project.id), ilike(schema.screens.title, args.title.trim().replace(/[\\%_]/g, (c) => `\\${c}`))));
    existing = rows.find((r) => !platform || r.platform === platform) ?? null;
  }
  if (existing) {
    const v = await addVersion(ctx.actor, project, existing, { ...fields, note: str(args, "note") }, upload);
    const meta = { ...fields };
    delete meta.title;
    delete meta.agent;
    if (Object.keys(meta).length) await updateScreen(ctx.actor, project, existing, meta);
    const screen = (await getScreen(project, existing.id))!;
    return json({ result: "new_version", version: v.n, screen: screenJson(project, screen) });
  }
  const screen = await createScreen(ctx.actor, project, fields, upload);
  return json({ result: "created", screen: screenJson(project, screen) });
}

export const screenTools: Tool[] = [
  {
    name: "list_sections",
    description: "List the screen-gallery sections of a project (one level of sub-sections) with their screen counts.",
    inputSchema: { type: "object", properties: { project: PROJECT_ARG }, required: ["project"] },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, false);
      return json({ sections: (await listSections(project.id)).map((s) => ({ id: s.id, name: s.name, parentId: s.parentId, screens: s.count })) });
    },
  },
  {
    name: "list_screens",
    description: "List the gallery screens of a project, filtered by section, platform, status, tag, ticket or free text. Paginated (default 30, max 100).",
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT_ARG,
        section: { type: "string", description: 'Section name or id, or "none" for unsorted screens.' },
        platform: { type: "string", enum: [...PLATFORMS] },
        status: { type: "string", enum: [...STATUSES] },
        tag: { type: "string" },
        ticket: { type: "string", description: "Ticket id, e.g. ED_1234." },
        query: { type: "string", description: "Free text over title, description, tags, tickets." },
        page: { type: "number" },
        pageSize: { type: "number" },
      },
      required: ["project"],
    },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, false);
      const section = str(args, "section");
      const res = await listScreens(project, {
        q: str(args, "query"),
        platform: str(args, "platform"),
        status: str(args, "status"),
        tag: str(args, "tag"),
        ticket: str(args, "ticket"),
        sectionId: section ? (section === "none" ? "none" : await resolveSection(project, section)) : undefined,
        page: num(args, "page") ?? 1,
        pageSize: Math.min(100, num(args, "pageSize") ?? 30),
      });
      return json({
        total: res.total,
        page: res.page,
        screens: res.items.map((s) => {
          const j = screenJson(project, s);
          return { id: j.id, title: j.title, platform: j.platform, status: j.status, type: j.type, tags: j.tags, tickets: j.tickets, section: j.sectionId, version: j.currentVersion, updatedAt: j.updatedAt, url: j.shareUrl };
        }),
      });
    },
  },
  {
    name: "get_screen",
    description: "One screen: metadata, versions and comments. The current image is returned as an MCP image (as=image, default; a thumbnail when the original is over 4 MB), or as a signed link valid 10 minutes (as=url), or not at all (as=none). HTML mockups are returned as a link / source text, never executed.",
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT_ARG,
        screen: { type: "string", description: "Screen id." },
        version: { type: "number", description: "Version number (default: current)." },
        as: { type: "string", enum: ["image", "url", "none"] },
      },
      required: ["project", "screen"],
    },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, false);
      const s = await needScreen(project, args.screen);
      const as = str(args, "as") ?? "image";
      if (!["image", "url", "none"].includes(as)) throw new ToolError('as must be "image", "url" or "none"');
      const n = num(args, "version") ?? s.currentVersion;
      const v = s.versions.find((x) => x.n === n);
      const meta = {
        ...screenJson(project, s),
        versions: s.versions.map((x) => versionJson(project, s, x)),
        comments: (await listComments(s.id)).map((c) => ({ id: c.id, author: c.author, body: c.body, versionN: c.versionN, createdAt: c.createdAt })),
      };
      if (!v || as === "none") return json(meta);
      if (as === "url") {
        const sig = signDownload(env.tokenSecret, { t: "screen", p: project.slug, s: s.id, n: v.n });
        return json({ ...meta, image: { url: `${ctx.origin}/mcp/dl?k=${sig.k}&s=${sig.s}`, expiresInSeconds: 600, mime: v.mime } });
      }
      if (v.kind === "html") {
        const html = (await versionBytes(project, s, v)).toString("utf8");
        return text(JSON.stringify({ ...meta, html: html.length > 60_000 ? `${html.slice(0, 60_000)}\n<!-- truncated -->` : html }, null, 2));
      }
      const big = v.bytes > 4 * 1024 * 1024;
      const bytes = big ? await thumbBytes(project, s, v) : await versionBytes(project, s, v);
      if (!bytes) return json(meta);
      return withImage(meta, bytes, big ? "image/webp" : v.mime);
    },
  },
  {
    name: "add_screen",
    description: "Add a screenshot to the project gallery. Give the image as imageBase64 (PNG/JPEG/WebP/GIF/AVIF, max 10 MB) or as `path` (absolute path readable by the server, only inside /tmp or /var/tmp). If `screen` (id) is given, or a screen with the same title and platform already exists, a NEW VERSION of it is created instead. Example: title \"Paywall\", platform \"ios\", section \"Onboarding\", tickets [\"ED_1234\"].",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT_ARG,
        imageBase64: { type: "string", description: "Image bytes, base64 (a data: URL is accepted)." },
        path: { type: "string", description: "Absolute server-side path of the image (inside /tmp or /var/tmp)." },
        filename: { type: "string", description: "Original file name (used for the default title)." },
        screen: { type: "string", description: "Existing screen id: add a version to it." },
        note: { type: "string", description: "Version note (when a version is created)." },
        ...META_PROPS,
      },
      required: ["project"],
    },
    async run(ctx, args) {
      const b64 = str(args, "imageBase64");
      const p = str(args, "path");
      if (!!b64 === !!p) throw new ToolError("give exactly one of imageBase64 or path");
      const upload = p ? await readLocalUpload(p, MAX_UPLOAD_BYTES) : base64Upload(b64!, str(args, "filename"), MAX_UPLOAD_BYTES);
      return upsertScreen(ctx, args, upload);
    },
  },
  {
    name: "add_html_mockup",
    description: "Add an HTML mockup to the gallery (shown in a sandboxed frame: scripts run, but no network, cookies or parent access). Same versioning rule as add_screen. Give `html` (max 8 MB) or `path` (inside /tmp or /var/tmp).",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT_ARG,
        html: { type: "string", description: "Full HTML document." },
        path: { type: "string", description: "Absolute server-side path of an .html file (inside /tmp or /var/tmp)." },
        screen: { type: "string", description: "Existing screen id: add a version to it." },
        note: { type: "string" },
        ...META_PROPS,
      },
      required: ["project"],
    },
    async run(ctx, args) {
      const html = str(args, "html");
      const p = str(args, "path");
      if (!!html === !!p) throw new ToolError("give exactly one of html or path");
      let upload: UploadInput;
      if (p) {
        upload = await readLocalUpload(p, MAX_HTML_BYTES);
        if (!/\.html?$/i.test(upload.filename)) throw new ToolError("path must be an .html file");
      } else {
        if (Buffer.byteLength(html!) > MAX_HTML_BYTES) throw new ToolError(`html too large (limit ${MAX_HTML_BYTES} bytes)`);
        upload = { filename: `${(str(args, "title") ?? "mockup").replace(/[^\w.-]+/g, "-").slice(0, 60)}.html`, mime: "text/html", data: Buffer.from(html!) };
      }
      return upsertScreen(ctx, args, upload);
    },
  },
  {
    name: "update_screen",
    description: "Change the metadata of a screen (title, section, platform, status, tags, description, tickets / links). tickets / links REPLACE the current ones. To change the image, call add_screen with `screen`.",
    write: true,
    inputSchema: { type: "object", properties: { project: PROJECT_ARG, screen: { type: "string", description: "Screen id." }, ...META_PROPS }, required: ["project", "screen"] },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, true);
      const s = await needScreen(project, args.screen);
      const fields = await metaFields(project, args);
      if (Object.keys(fields).length === 0) throw new ToolError("nothing to update: give at least one field");
      await updateScreen(ctx.actor, project, s, fields);
      return json({ screen: screenJson(project, (await getScreen(project, s.id))!) });
    },
  },
  {
    name: "comment_screen",
    description: "Comment a screen (markdown; @username mentions a project member). The comment is signed with the token's label. Optional pin position (0..1) on the image.",
    write: true,
    inputSchema: {
      type: "object",
      properties: {
        project: PROJECT_ARG,
        screen: { type: "string", description: "Screen id." },
        body: { type: "string", description: "Comment text (max 5000 chars)." },
        version: { type: "number", description: "Version commented (default: current)." },
        pinX: { type: "number", description: "Pin x, 0..1." },
        pinY: { type: "number", description: "Pin y, 0..1." },
      },
      required: ["project", "screen", "body"],
    },
    async run(ctx, args) {
      const { project } = await needProject(ctx, args, true);
      const s = await needScreen(project, args.screen);
      const c = await addComment(ctx.actor, project, s, { body: args.body, versionN: args.version, pinX: args.pinX, pinY: args.pinY, agent: ctx.token.label });
      return json({ comment: { id: c.id, author: c.author, body: c.body, versionN: c.versionN } });
    },
  },
];
