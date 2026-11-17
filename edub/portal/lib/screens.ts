import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "./db/index.ts";
import type { Project, Screen, ScreenComment, ScreenLink, ScreenSection, ScreenVersion } from "./db/schema.ts";
import type { Identity } from "./identity.ts";
import { HttpError, logActivity } from "./projects.ts";
import { resolveRole } from "./rights.ts";
import type { UploadInput } from "./screens-input.ts";
import {
  extractMentions, parseLinks, parsePlatform, parseStatus, parseTags, parseType, titleFromFilename, ticketsOfLinks,
  PLATFORMS, STATUSES,
} from "./screens-model.ts";
import { inspectUpload, makeThumb, readVersionFile, removeScreenFiles, thumbPath, versionPath, writeVersionFile, type Stored } from "./screens-store.ts";
import { readFile, rm } from "node:fs/promises";

/** Gallery mutations and queries. Rights are checked by the routes (withProject). */
const db = () => getDb();
const UUID = /^[0-9a-f-]{36}$/;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

const text = (raw: unknown, max: number, what: string, required = false): string | null => {
  if (raw === undefined || raw === null || raw === "") {
    if (required) throw new HttpError(400, `${what} requis`);
    return null;
  }
  if (typeof raw !== "string" || raw.length > max) throw new HttpError(400, `${what} invalide`);
  const v = raw.trim();
  if (!v && required) throw new HttpError(400, `${what} requis`);
  return v || null;
};

/* ───────────── sections ───────────── */

export async function listSections(projectId: string): Promise<(ScreenSection & { count: number })[]> {
  const rows = await db().select().from(schema.screenSections).where(eq(schema.screenSections.projectId, projectId)).orderBy(asc(schema.screenSections.position), asc(schema.screenSections.name));
  const counts = await db()
    .select({ id: schema.screens.sectionId, n: sql<number>`count(*)::int` })
    .from(schema.screens)
    .where(eq(schema.screens.projectId, projectId))
    .groupBy(schema.screens.sectionId);
  const byId = new Map(counts.map((c) => [c.id, c.n]));
  return rows.map((s) => ({ ...s, count: byId.get(s.id) ?? 0 }));
}

async function sectionOf(projectId: string, id: unknown): Promise<ScreenSection | null> {
  if (id === undefined || id === null || id === "") return null;
  if (!isUuid(id)) throw new HttpError(400, "section invalide");
  const [s] = await db().select().from(schema.screenSections).where(and(eq(schema.screenSections.id, id), eq(schema.screenSections.projectId, projectId)));
  if (!s) throw new HttpError(400, "section inconnue");
  return s;
}

export async function createSection(actor: Identity, project: Project, input: Record<string, unknown>): Promise<ScreenSection> {
  const name = text(input.name, 80, "nom", true)!;
  const parent = await sectionOf(project.id, input.parentId);
  if (parent?.parentId) throw new HttpError(400, "une section ne s'imbrique que sur un niveau");
  const [max] = await db()
    .select({ m: sql<number>`coalesce(max(${schema.screenSections.position}), -1)::int` })
    .from(schema.screenSections)
    .where(and(eq(schema.screenSections.projectId, project.id), parent ? eq(schema.screenSections.parentId, parent.id) : sql`${schema.screenSections.parentId} is null`));
  const [row] = await db().insert(schema.screenSections).values({ projectId: project.id, parentId: parent?.id ?? null, name, position: (max?.m ?? -1) + 1 }).returning();
  await logActivity(project.id, actor.username, "section.created", { kind: "section", name });
  return row!;
}

export async function updateSection(actor: Identity, project: Project, id: string, input: Record<string, unknown>): Promise<ScreenSection> {
  const cur = await sectionOf(project.id, id);
  if (!cur) throw new HttpError(404, "not_found");
  const set: Partial<typeof schema.screenSections.$inferInsert> = {};
  if ("name" in input) set.name = text(input.name, 80, "nom", true)!;
  if ("position" in input) {
    if (typeof input.position !== "number" || !Number.isInteger(input.position) || input.position < 0 || input.position > 100000) throw new HttpError(400, "position invalide");
    set.position = input.position;
  }
  if ("parentId" in input) {
    const parent = await sectionOf(project.id, input.parentId);
    if (parent && (parent.id === cur.id || parent.parentId)) throw new HttpError(400, "imbrication invalide");
    if (parent) {
      const [kids] = await db().select({ n: sql<number>`count(*)::int` }).from(schema.screenSections).where(eq(schema.screenSections.parentId, cur.id));
      if ((kids?.n ?? 0) > 0) throw new HttpError(400, "une section qui a des sous-sections reste à la racine");
    }
    set.parentId = parent?.id ?? null;
  }
  if (input.move === "up" || input.move === "down") {
    // renumber the siblings 0..n-1 and swap with the neighbour
    const sibs = (await listSections(project.id)).filter((x) => (x.parentId ?? null) === (cur.parentId ?? null));
    const i = sibs.findIndex((x) => x.id === cur.id);
    const j = input.move === "up" ? i - 1 : i + 1;
    if (j >= 0 && j < sibs.length) [sibs[i], sibs[j]] = [sibs[j]!, sibs[i]!];
    await Promise.all(sibs.map((x, k) => db().update(schema.screenSections).set({ position: k }).where(eq(schema.screenSections.id, x.id))));
  }
  if (Object.keys(set).length === 0) return (await sectionOf(project.id, id)) ?? cur;
  const [row] = await db().update(schema.screenSections).set(set).where(eq(schema.screenSections.id, id)).returning();
  await logActivity(project.id, actor.username, "section.updated", { kind: "section", name: row!.name });
  return row!;
}

export async function deleteSection(actor: Identity, project: Project, id: string): Promise<void> {
  const cur = await sectionOf(project.id, id);
  if (!cur) throw new HttpError(404, "not_found");
  // screens are kept (section_id set null), sub-sections cascade and leave their screens unsorted too
  await db().delete(schema.screenSections).where(eq(schema.screenSections.id, id));
  await logActivity(project.id, actor.username, "section.deleted", { kind: "section", name: cur.name });
}

/* ───────────── screens ───────────── */

export type CurrentVersion = Pick<ScreenVersion, "n" | "kind" | "mime" | "width" | "height" | "bytes" | "hasThumb" | "createdAt">;
export type ScreenItem = Screen & { current: CurrentVersion | null };

export type ScreenQuery = {
  q?: string;
  platform?: string;
  status?: string;
  tag?: string;
  ticket?: string;
  sectionId?: string;
  type?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

export function screenFilters(project: Project, f: ScreenQuery, sectionIds: string[] | null): SQL {
  const s = schema.screens;
  const conds: SQL[] = [eq(s.projectId, project.id)];
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(s.title, like), ilike(s.description, like), sql`array_to_string(${s.tags}, ' ') ilike ${like}`, sql`array_to_string(${s.tickets}, ' ') ilike ${like}`)!);
  }
  const platform = f.platform ? parsePlatform(f.platform) : null;
  if (f.platform && !platform) conds.push(sql`false`);
  if (platform) conds.push(eq(s.platform, platform));
  const status = f.status ? parseStatus(f.status) : null;
  if (f.status && !status) conds.push(sql`false`);
  if (status) conds.push(eq(s.status, status));
  const type = f.type ? parseType(f.type) : null;
  if (type) conds.push(eq(s.type, type));
  if (f.tag) conds.push(sql`${f.tag.toLowerCase()} = any(${s.tags})`);
  if (f.ticket) conds.push(sql`${f.ticket.toUpperCase()} = any(${s.tickets})`);
  if (sectionIds) conds.push(sectionIds.length ? inArray(s.sectionId, sectionIds) : sql`${s.sectionId} is null`);
  return and(...conds)!;
}

/** `section=none` = unsorted screens; a root section includes its sub-sections. */
async function sectionScope(projectId: string, raw: string | undefined): Promise<string[] | null> {
  if (!raw) return null;
  if (raw === "none") return [];
  if (!isUuid(raw)) return ["00000000-0000-0000-0000-000000000000"];
  const kids = await db().select({ id: schema.screenSections.id }).from(schema.screenSections).where(and(eq(schema.screenSections.projectId, projectId), eq(schema.screenSections.parentId, raw)));
  return [raw, ...kids.map((k) => k.id)];
}

const currentCols = {
  n: schema.screenVersions.n,
  kind: schema.screenVersions.kind,
  mime: schema.screenVersions.mime,
  width: schema.screenVersions.width,
  height: schema.screenVersions.height,
  bytes: schema.screenVersions.bytes,
  hasThumb: schema.screenVersions.hasThumb,
  createdAt: schema.screenVersions.createdAt,
};

export async function listScreens(project: Project, f: ScreenQuery) {
  const s = schema.screens;
  const scope = await sectionScope(project.id, f.sectionId);
  const where = screenFilters(project, f, scope);
  const pageSize = Math.min(200, Math.max(1, Math.trunc(f.pageSize ?? 60)));
  const page = Math.max(1, Math.trunc(f.page ?? 1));
  const order = f.sort === "title" ? [asc(s.title)] : f.sort === "oldest" ? [asc(s.createdAt)] : f.sort === "status" ? [asc(s.status), desc(s.updatedAt)] : [desc(s.updatedAt)];
  const [rows, [total]] = await Promise.all([
    db()
      .select({ screen: s, current: currentCols })
      .from(s)
      .leftJoin(schema.screenVersions, and(eq(schema.screenVersions.screenId, s.id), eq(schema.screenVersions.n, s.currentVersion)))
      .where(where)
      .orderBy(...order, asc(s.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    db().select({ n: sql<number>`count(*)::int` }).from(s).where(where),
  ]);
  const items: ScreenItem[] = rows.map((r) => ({ ...r.screen, current: r.current?.n ? r.current : null }));
  return { items, total: total?.n ?? 0, page, pageSize };
}

/** Distinct tags of the project (filter chips). */
export async function projectTags(projectId: string): Promise<string[]> {
  const r = await db().execute(sql`select distinct unnest(tags) as t from screen where project_id = ${projectId} order by 1 limit 200`);
  return (r.rows as { t: string }[]).map((x) => x.t);
}

export async function getScreen(project: Project, id: string): Promise<(ScreenItem & { versions: ScreenVersion[] }) | null> {
  if (!isUuid(id)) return null;
  const [s] = await db().select().from(schema.screens).where(and(eq(schema.screens.id, id), eq(schema.screens.projectId, project.id)));
  if (!s) return null;
  const versions = await db().select().from(schema.screenVersions).where(eq(schema.screenVersions.screenId, id)).orderBy(desc(schema.screenVersions.n));
  const cur = versions.find((v) => v.n === s.currentVersion) ?? null;
  return { ...s, current: cur, versions };
}

type Meta = { title: string; platform: string; status: string; tags: string[]; description: string; links: ScreenLink[]; sectionId: string | null };

async function readMeta(project: Project, f: Record<string, unknown>, fallbackTitle: string): Promise<Meta> {
  const platform = f.platform === undefined || f.platform === "" ? "autre" : parsePlatform(f.platform);
  if (!platform) throw new HttpError(400, `plateforme invalide (${PLATFORMS.join(", ")})`);
  const status = f.status === undefined || f.status === "" ? "proposé" : parseStatus(f.status);
  if (!status) throw new HttpError(400, `statut invalide (${STATUSES.join(", ")})`);
  const tags = parseTags(f.tags);
  if (!tags) throw new HttpError(400, "tags invalides");
  const links = parseLinks(f.links);
  if (!links) throw new HttpError(400, "liens invalides (ED_1234 ou URL http/https)");
  const section = await sectionOf(project.id, f.sectionId);
  return { title: text(f.title, 160, "titre") ?? fallbackTitle, platform, status, tags, description: text(f.description, 20000, "description") ?? "", links, sectionId: section?.id ?? null };
}

function authorOf(actor: Identity, f: Record<string, unknown>): { authorKind: "user" | "agent"; author: string } {
  const agent = typeof f.agent === "string" ? f.agent.trim().slice(0, 60) : "";
  return agent ? { authorKind: "agent", author: agent } : { authorKind: "user", author: actor.username };
}

export async function createScreen(actor: Identity, project: Project, f: Record<string, unknown>, upload: UploadInput | null): Promise<ScreenItem> {
  const requested = f.type === undefined || f.type === "" ? null : parseType(f.type);
  if (f.type !== undefined && f.type !== "" && !requested) throw new HttpError(400, "type invalide (capture, maquette-html, design)");
  const type = requested ?? (upload ? null : f.designFileId ? "design" : null);
  if (!upload && type !== "design") throw new HttpError(400, "fichier requis (multipart `file` ou JSON `contentBase64`)");
  if (upload && type === "design") throw new HttpError(400, "un écran `design` n'a pas de fichier");

  let stored: Stored | null = null;
  if (upload) {
    stored = await inspectUpload(upload.filename, upload.mime, upload.data);
    const want = stored.detected.kind === "html" ? "maquette-html" : "capture";
    if (type && type !== want) throw new HttpError(400, `le fichier est de type ${want}, pas ${type}`);
  }
  const meta = await readMeta(project, f, upload ? titleFromFilename(upload.filename) : "Sans titre");
  let designFileId: string | null = null;
  let frameId: string | null = null;
  if (type === "design") {
    if (!isUuid(f.designFileId)) throw new HttpError(400, "designFileId requis");
    const [file] = await db().select({ id: schema.designFiles.id }).from(schema.designFiles).where(and(eq(schema.designFiles.id, f.designFileId), eq(schema.designFiles.projectId, project.id)));
    if (!file) throw new HttpError(400, "fichier .op inconnu dans ce projet");
    designFileId = file.id;
    frameId = text(f.frameId, 200, "frameId");
  }
  const author = authorOf(actor, f);
  const id = crypto.randomUUID();
  try {
    await db().transaction(async (tx) => {
      await tx.insert(schema.screens).values({
        id, projectId: project.id, sectionId: meta.sectionId, title: meta.title, platform: meta.platform, type: stored ? (stored.detected.kind === "html" ? "maquette-html" : "capture") : "design",
        tags: meta.tags, description: meta.description, status: meta.status, links: meta.links, tickets: ticketsOfLinks(meta.links), designFileId, frameId, ...author, currentVersion: stored ? 1 : 0,
      });
      if (stored) await insertVersion(tx, project, id, 1, stored, null, author);
    });
  } catch (e) {
    await removeScreenFiles(project.slug, id).catch(() => {});
    throw e;
  }
  await logActivity(project.id, actor.username, "screen.created", { kind: "screen", name: meta.title });
  return (await getScreen(project, id))!;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

async function insertVersion(tx: Tx, project: Project, screenId: string, n: number, s: Stored, note: string | null, author: { authorKind: string; author: string }) {
  await writeVersionFile(project.slug, screenId, n, s);
  const hasThumb = await makeThumb(project.slug, screenId, n, s.detected.kind, s.data);
  await tx.insert(schema.screenVersions).values({
    screenId, n, kind: s.detected.kind, mime: s.detected.mime, ext: s.detected.ext, width: s.width, height: s.height, bytes: s.bytes, sha256: s.sha256, note, ...author, hasThumb,
  });
}

export async function addVersion(actor: Identity, project: Project, screen: Screen, f: Record<string, unknown>, upload: UploadInput | null): Promise<ScreenVersion> {
  if (!upload) throw new HttpError(400, "fichier requis");
  if (screen.type === "design") throw new HttpError(400, "un écran `design` n'a pas de versions de fichier");
  const stored = await inspectUpload(upload.filename, upload.mime, upload.data);
  if ((stored.detected.kind === "html") !== (screen.type === "maquette-html")) throw new HttpError(400, `cet écran est une ${screen.type}: la nouvelle version doit être du même type`);
  const note = text(f.note, 500, "note");
  const author = authorOf(actor, f);
  let n = 0;
  try {
    await db().transaction(async (tx) => {
      const [bumped] = await tx.update(schema.screens).set({ currentVersion: sql`${schema.screens.currentVersion} + 1`, updatedAt: new Date() }).where(eq(schema.screens.id, screen.id)).returning({ n: schema.screens.currentVersion });
      n = bumped!.n;
      await insertVersion(tx, project, screen.id, n, stored, note, author);
    });
  } catch (e) {
    if (n) await Promise.all([versionPath(project.slug, screen.id, n, stored.detected.ext), thumbPath(project.slug, screen.id, n)].map((p) => rm(p, { force: true })));
    throw e;
  }
  await logActivity(project.id, actor.username, "screen.version", { kind: "screen", name: screen.title }, { n });
  const [v] = await db().select().from(schema.screenVersions).where(and(eq(schema.screenVersions.screenId, screen.id), eq(schema.screenVersions.n, n)));
  return v!;
}

export async function updateScreen(actor: Identity, project: Project, screen: Screen, f: Record<string, unknown>): Promise<Screen> {
  const set: Partial<typeof schema.screens.$inferInsert> = {};
  if ("title" in f) set.title = text(f.title, 160, "titre", true)!;
  if ("description" in f) set.description = text(f.description, 20000, "description") ?? "";
  if ("platform" in f) {
    const p = parsePlatform(f.platform);
    if (!p) throw new HttpError(400, "plateforme invalide");
    set.platform = p;
  }
  if ("status" in f) {
    const st = parseStatus(f.status);
    if (!st) throw new HttpError(400, "statut invalide");
    set.status = st;
  }
  if ("tags" in f) {
    const tags = parseTags(f.tags);
    if (!tags) throw new HttpError(400, "tags invalides");
    set.tags = tags;
  }
  if ("links" in f) {
    const links = parseLinks(f.links);
    if (!links) throw new HttpError(400, "liens invalides");
    set.links = links;
    set.tickets = ticketsOfLinks(links);
  }
  if ("sectionId" in f) set.sectionId = (await sectionOf(project.id, f.sectionId))?.id ?? null;
  if ("frameId" in f && screen.type === "design") set.frameId = text(f.frameId, 200, "frameId");
  if (Object.keys(set).length === 0) return screen;
  set.updatedAt = new Date();
  const [row] = await db().update(schema.screens).set(set).where(eq(schema.screens.id, screen.id)).returning();
  await logActivity(project.id, actor.username, "screen.updated", { kind: "screen", name: row!.title }, undefined, 60_000);
  return row!;
}

export async function deleteScreen(actor: Identity, project: Project, screen: Screen): Promise<void> {
  await db().delete(schema.screens).where(eq(schema.screens.id, screen.id));
  await removeScreenFiles(project.slug, screen.id);
  await logActivity(project.id, actor.username, "screen.deleted", { kind: "screen", name: screen.title });
}

/* ───────────── files ───────────── */

export async function versionOf(screen: Screen, nRaw: string): Promise<ScreenVersion | null> {
  const n = nRaw === "current" ? screen.currentVersion : /^\d{1,6}$/.test(nRaw) ? Number(nRaw) : NaN;
  if (!Number.isInteger(n) || n < 1) return null;
  const [v] = await db().select().from(schema.screenVersions).where(and(eq(schema.screenVersions.screenId, screen.id), eq(schema.screenVersions.n, n)));
  return v ?? null;
}

export const versionBytes = (project: Project, screen: Screen, v: ScreenVersion) => readVersionFile(project.slug, screen.id, v.n, v.ext);

/** Thumbnail bytes; (re)generated on demand when missing (e.g. Chrome was busy at upload time). */
export async function thumbBytes(project: Project, screen: Screen, v: ScreenVersion): Promise<Buffer | null> {
  if (v.hasThumb) {
    try {
      return await readFile(thumbPath(project.slug, screen.id, v.n));
    } catch {
      /* fall through: regenerate */
    }
  }
  const ok = await makeThumb(project.slug, screen.id, v.n, v.kind === "html" ? "html" : "image", await versionBytes(project, screen, v));
  if (!ok) return null;
  await db().update(schema.screenVersions).set({ hasThumb: true }).where(eq(schema.screenVersions.id, v.id));
  return readFile(thumbPath(project.slug, screen.id, v.n));
}

/* ───────────── comments ───────────── */

export async function listComments(screenId: string): Promise<ScreenComment[]> {
  return db().select().from(schema.screenComments).where(eq(schema.screenComments.screenId, screenId)).orderBy(asc(schema.screenComments.createdAt));
}

/** Users who have a role on the project (the only ones an `@mention` may point to). */
export async function mentionable(project: Project): Promise<string[]> {
  const [users, members] = await Promise.all([db().select().from(schema.users), db().select().from(schema.projectMembers).where(eq(schema.projectMembers.projectId, project.id))]);
  const names = new Set<string>(members.filter((m) => m.principalKind === "user").map((m) => m.principal));
  for (const u of users) if (resolveRole(u, members)) names.add(u.username);
  return [...names].sort();
}

export async function addComment(actor: Identity, project: Project, screen: Screen, f: Record<string, unknown>): Promise<ScreenComment> {
  const body = text(f.body, 5000, "commentaire", true)!;
  const people = new Set(await mentionable(project));
  const mentions = extractMentions(body).filter((m) => people.has(m));
  let pinX: number | null = null;
  let pinY: number | null = null;
  if (f.pinX !== undefined && f.pinX !== null) {
    const x = Number(f.pinX), y = Number(f.pinY);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new HttpError(400, "épingle invalide (0..1)");
    pinX = x;
    pinY = y;
  }
  const versionN = f.versionN === undefined || f.versionN === null ? screen.currentVersion || null : Number(f.versionN);
  if (versionN !== null && !Number.isInteger(versionN)) throw new HttpError(400, "version invalide");
  const author = authorOf(actor, f);
  const [row] = await db().insert(schema.screenComments).values({ screenId: screen.id, author: author.authorKind === "agent" ? `${author.author} (agent)` : author.author, body, mentions, pinX, pinY, versionN }).returning();
  await logActivity(project.id, actor.username, "screen.commented", { kind: "screen", name: screen.title }, mentions.length ? { mentions } : undefined);
  return row!;
}

export async function deleteComment(actor: Identity, canManage: boolean, screen: Screen, commentId: string): Promise<void> {
  if (!isUuid(commentId)) throw new HttpError(404, "not_found");
  const [c] = await db().select().from(schema.screenComments).where(and(eq(schema.screenComments.id, commentId), eq(schema.screenComments.screenId, screen.id)));
  if (!c) throw new HttpError(404, "not_found");
  if (!canManage && c.author !== actor.username) throw new HttpError(403, "tu ne peux supprimer que tes commentaires");
  await db().delete(schema.screenComments).where(eq(schema.screenComments.id, commentId));
}
