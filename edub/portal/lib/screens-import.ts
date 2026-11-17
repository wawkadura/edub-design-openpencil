import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { writeFile } from "node:fs/promises";
import { getDb, schema } from "./db/index.ts";
import type { Project, ScreenSection } from "./db/schema.ts";
import { logActivity } from "./projects.ts";
import type { Platform, ScreenStatus } from "./screens-model.ts";
import { imageThumb, inspectUpload, makeThumb, thumbPath, writeVersionFile } from "./screens-store.ts";

/** DB side of the TamaFit designs import: idempotent upserts keyed by `source_key` / (parent, name). */
const db = () => getDb();
const DESC_MAX = 20000;
export const clip = (s: string) => (s.length > DESC_MAX ? `${s.slice(0, DESC_MAX - 40)}\n\n… (note tronquée)` : s);

/** Section by (project, parent, name); created at the end of its siblings when missing. */
export async function ensureSection(projectId: string, parentId: string | null, name: string, position?: number): Promise<ScreenSection> {
  const s = schema.screenSections;
  const [found] = await db().select().from(s).where(and(eq(s.projectId, projectId), parentId ? eq(s.parentId, parentId) : isNull(s.parentId), eq(s.name, name)));
  if (found) return found;
  const [max] = await db().select({ m: sql<number>`coalesce(max(${s.position}), -1)::int` }).from(s).where(and(eq(s.projectId, projectId), parentId ? eq(s.parentId, parentId) : isNull(s.parentId)));
  const [row] = await db().insert(s).values({ projectId, parentId, name, position: position ?? (max?.m ?? -1) + 1 }).returning();
  return row!;
}

/** Section note: only filled while empty, so a later edit by Walid is never overwritten. */
export async function fillSectionNote(section: ScreenSection, note: string): Promise<boolean> {
  if (!note.trim() || section.description.trim()) return false;
  await db().update(schema.screenSections).set({ description: clip(note) }).where(eq(schema.screenSections.id, section.id));
  return true;
}

export type ImportedScreen = {
  sourceKey: string;
  title: string;
  platform: Platform;
  status: ScreenStatus;
  tags: string[];
  description: string;
  sectionId: string | null;
  filename: string;
  data: Buffer;
  /** Commit / file date of the source. */
  date: Date;
  /** A PNG that IS the rendering of this HTML mockup: used as its thumbnail. */
  renderPng?: Buffer;
  author: string;
};

export type Outcome = "created" | "new-version" | "unchanged";

/**
 * Upsert one screen by (project, source_key). Same bytes → untouched (manual edits survive a re-run);
 * other bytes → a new version (history kept). Metadata is only set at creation, except an empty description.
 */
export async function upsertImported(project: Project, a: ImportedScreen): Promise<{ outcome: Outcome; id: string }> {
  const stored = await inspectUpload(a.filename, undefined, a.data);
  const s = schema.screens;
  const [cur] = await db().select().from(s).where(and(eq(s.projectId, project.id), eq(s.sourceKey, a.sourceKey)));
  const author = { authorKind: "agent", author: a.author } as const;
  const thumb = async (id: string, n: number) => {
    if (a.renderPng) {
      try {
        await writeFile(thumbPath(project.slug, id, n), await imageThumb(a.renderPng));
        return true;
      } catch {
        /* fall back to the generated one */
      }
    }
    return makeThumb(project.slug, id, n, stored.detected.kind, stored.data);
  };
  const versionRow = (id: string, n: number, hasThumb: boolean, note: string | null) => ({
    screenId: id, n, kind: stored.detected.kind, mime: stored.detected.mime, ext: stored.detected.ext, width: stored.width, height: stored.height,
    bytes: stored.bytes, sha256: stored.sha256, note, ...author, hasThumb, createdAt: a.date,
  });

  if (!cur) {
    const id = crypto.randomUUID();
    await writeVersionFile(project.slug, id, 1, stored);
    const hasThumb = await thumb(id, 1);
    await db().transaction(async (tx) => {
      await tx.insert(s).values({
        id, projectId: project.id, sectionId: a.sectionId, title: a.title.slice(0, 160), platform: a.platform, type: stored.detected.kind === "html" ? "maquette-html" : "capture",
        tags: a.tags, description: clip(a.description), status: a.status, links: [], tickets: [], ...author, currentVersion: 1, sourceKey: a.sourceKey, createdAt: a.date, updatedAt: a.date,
      });
      await tx.insert(schema.screenVersions).values(versionRow(id, 1, hasThumb, "Import docs/designs"));
    });
    return { outcome: "created", id };
  }

  const [last] = await db().select().from(schema.screenVersions).where(and(eq(schema.screenVersions.screenId, cur.id), eq(schema.screenVersions.n, cur.currentVersion)));
  const fillDesc = !cur.description.trim() && a.description.trim() ? { description: clip(a.description) } : {};
  if (last?.sha256 === stored.sha256) {
    if (fillDesc.description) await db().update(s).set(fillDesc).where(eq(s.id, cur.id));
    return { outcome: "unchanged", id: cur.id };
  }
  const n = cur.currentVersion + 1;
  await writeVersionFile(project.slug, cur.id, n, stored);
  const hasThumb = await thumb(cur.id, n);
  await db().transaction(async (tx) => {
    await tx.update(s).set({ currentVersion: n, updatedAt: a.date, ...fillDesc }).where(eq(s.id, cur.id));
    await tx.insert(schema.screenVersions).values(versionRow(cur.id, n, hasThumb, "Réimport docs/designs"));
  });
  return { outcome: "new-version", id: cur.id };
}

export const existingKeys = async (projectId: string): Promise<Map<string, string>> => {
  const rows = await db().select({ id: schema.screens.id, k: schema.screens.sourceKey }).from(schema.screens).where(eq(schema.screens.projectId, projectId)).orderBy(asc(schema.screens.createdAt));
  return new Map(rows.filter((r) => r.k).map((r) => [r.k!, r.id]));
};

export const logImport = (project: Project, actor: string, counts: Record<string, number>) =>
  logActivity(project.id, actor, "screens.imported", { kind: "project", name: project.name }, counts);
