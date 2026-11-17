import { and, desc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb, schema } from "./db/index.ts";
import type { Activity, DesignFile, Folder, Member, PrincipalKind, Project, ProjectRole } from "./db/schema.ts";
import { countScreens, convertFig, EMPTY_DOCUMENT, fetchDocument, isOpDocument, pushDocument, renderPng } from "./editor-client.ts";
import { env } from "./env.ts";
import type { Identity } from "./identity.ts";
import { newTenantId, tenantDocumentPath } from "./tenant-store.ts";
import { authorFor, commitFile, listVersions, readHead, readVersion, removeFile, type Version } from "./versioning.ts";

/** Mutations and snapshots behind the portal API. Rights are checked by the caller (routes). */
export const TRASH_DAYS = 30;
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const cleanName = (raw: unknown, max = 120): string => {
  const v = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!v || v.length > max) throw new HttpError(400, "nom invalide");
  return v;
};
const optText = (raw: unknown, max: number): string | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > max) throw new HttpError(400, "valeur invalide");
  return raw.trim() || null;
};
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/* ───────────── activity ───────────── */

export async function logActivity(
  projectId: string,
  actor: string,
  action: string,
  target?: { kind: string; name: string },
  meta?: Record<string, unknown>,
  throttleMs = 0,
): Promise<void> {
  const db = getDb();
  if (throttleMs > 0 && target) {
    const [last] = await db
      .select({ at: schema.activities.createdAt })
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.projectId, projectId),
          eq(schema.activities.actor, actor),
          eq(schema.activities.action, action),
          eq(schema.activities.targetName, target.name),
        ),
      )
      .orderBy(desc(schema.activities.createdAt))
      .limit(1);
    if (last && Date.now() - last.at.getTime() < throttleMs) return;
  }
  await db.insert(schema.activities).values({
    projectId,
    actor,
    action,
    targetKind: target?.kind ?? null,
    targetName: target?.name ?? null,
    meta: meta ?? null,
  });
}

export async function listActivity(projectId: string, limit = 100): Promise<Activity[]> {
  return getDb()
    .select()
    .from(schema.activities)
    .where(eq(schema.activities.projectId, projectId))
    .orderBy(desc(schema.activities.createdAt))
    .limit(limit);
}

/* ───────────── projects & members ───────────── */

export async function createProject(
  actor: Identity,
  input: Record<string, unknown>,
  slugify: (s: string) => string,
  slugRe: RegExp,
): Promise<Project> {
  const name = cleanName(input.name, 80);
  const slug = typeof input.slug === "string" && input.slug ? input.slug : slugify(name);
  if (!slugRe.test(slug)) throw new HttpError(400, "slug invalide");
  const color = optText(input.color, 7);
  if (color && !COLOR_RE.test(color)) throw new HttpError(400, "couleur invalide");
  const db = getDb();
  const [dup] = await db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, slug));
  if (dup) throw new HttpError(409, "ce slug existe déjà");
  const [me] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, actor.username));
  const [project] = await db
    .insert(schema.projects)
    .values({
      slug,
      name,
      emoji: optText(input.emoji, 8),
      color,
      description: optText(input.description, 500),
      createdBy: me?.id ?? null,
    })
    .returning();
  if (!project) throw new HttpError(500, "création impossible");
  await db.insert(schema.projectMembers).values({ projectId: project.id, principalKind: "user", principal: actor.username, role: "owner" });
  await logActivity(project.id, actor.username, "project.created", { kind: "project", name });
  return project;
}

export async function updateProject(actor: Identity, project: Project, input: Record<string, unknown>): Promise<Project> {
  const set: Partial<typeof schema.projects.$inferInsert> = {};
  if ("name" in input) set.name = cleanName(input.name, 80);
  if ("emoji" in input) set.emoji = optText(input.emoji, 8);
  if ("description" in input) set.description = optText(input.description, 500);
  if ("color" in input) {
    const c = optText(input.color, 7);
    if (c && !COLOR_RE.test(c)) throw new HttpError(400, "couleur invalide");
    set.color = c;
  }
  if ("archived" in input) set.archived = input.archived === true;
  if (Object.keys(set).length === 0) return project;
  const [row] = await getDb().update(schema.projects).set(set).where(eq(schema.projects.id, project.id)).returning();
  await logActivity(project.id, actor.username, set.archived !== undefined ? (set.archived ? "project.archived" : "project.unarchived") : "project.updated", {
    kind: "project",
    name: row?.name ?? project.name,
  });
  return row ?? project;
}

export async function setMember(
  actor: Identity,
  project: Project,
  kind: PrincipalKind,
  principal: string,
  role: ProjectRole,
): Promise<Member> {
  const [row] = await getDb()
    .insert(schema.projectMembers)
    .values({ projectId: project.id, principalKind: kind, principal, role })
    .onConflictDoUpdate({
      target: [schema.projectMembers.projectId, schema.projectMembers.principalKind, schema.projectMembers.principal],
      set: { role },
    })
    .returning();
  if (!row) throw new HttpError(500, "partage impossible");
  await logActivity(project.id, actor.username, "member.set", { kind: kind, name: principal }, { role });
  return row;
}

export async function removeMember(actor: Identity, project: Project, kind: PrincipalKind, principal: string): Promise<void> {
  const db = getDb();
  const members = await db.select().from(schema.projectMembers).where(eq(schema.projectMembers.projectId, project.id));
  const target = members.find((m) => m.principalKind === kind && m.principal === principal);
  if (!target) throw new HttpError(404, "membre introuvable");
  const owners = members.filter((m) => m.role === "owner");
  if (target.role === "owner" && owners.length === 1) throw new HttpError(409, "un projet garde au moins un propriétaire");
  await db
    .delete(schema.projectMembers)
    .where(
      and(
        eq(schema.projectMembers.projectId, project.id),
        eq(schema.projectMembers.principalKind, kind),
        eq(schema.projectMembers.principal, principal),
      ),
    );
  await logActivity(project.id, actor.username, "member.removed", { kind, name: principal });
}

/* ───────────── folders & files ───────────── */

export async function folderTree(projectId: string): Promise<Folder[]> {
  return getDb()
    .select()
    .from(schema.folders)
    .where(and(eq(schema.folders.projectId, projectId), isNull(schema.folders.trashedAt)))
    .orderBy(schema.folders.name);
}

export async function createFolder(actor: Identity, project: Project, nameRaw: unknown, parentId: unknown): Promise<Folder> {
  const name = cleanName(nameRaw, 80);
  const parent = typeof parentId === "string" && parentId ? parentId : null;
  if (parent) {
    const tree = await folderTree(project.id);
    if (!tree.some((f) => f.id === parent)) throw new HttpError(404, "dossier introuvable");
  }
  const [row] = await getDb().insert(schema.folders).values({ projectId: project.id, parentId: parent, name }).returning();
  if (!row) throw new HttpError(500, "création impossible");
  await logActivity(project.id, actor.username, "folder.created", { kind: "folder", name });
  return row;
}

export async function renameFolder(actor: Identity, project: Project, folderId: string, nameRaw: unknown): Promise<void> {
  const name = cleanName(nameRaw, 80);
  const res = await getDb()
    .update(schema.folders)
    .set({ name })
    .where(and(eq(schema.folders.id, folderId), eq(schema.folders.projectId, project.id)))
    .returning({ id: schema.folders.id });
  if (res.length === 0) throw new HttpError(404, "dossier introuvable");
  await logActivity(project.id, actor.username, "folder.renamed", { kind: "folder", name });
}

/** Deleting a folder sends its files (any depth) to the trash; the folders themselves go away. */
export async function deleteFolder(actor: Identity, project: Project, folderId: string): Promise<void> {
  const db = getDb();
  const all = await db.select().from(schema.folders).where(eq(schema.folders.projectId, project.id));
  const root = all.find((f) => f.id === folderId);
  if (!root) throw new HttpError(404, "dossier introuvable");
  const ids = new Set([folderId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of all) if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) (ids.add(f.id), (grew = true));
  }
  await db
    .update(schema.designFiles)
    .set({ trashedAt: new Date(), folderId: null })
    .where(and(inArray(schema.designFiles.folderId, [...ids]), isNull(schema.designFiles.trashedAt)));
  await db.delete(schema.folders).where(eq(schema.folders.id, folderId));
  await logActivity(project.id, actor.username, "folder.deleted", { kind: "folder", name: root.name });
}

export async function listFiles(projectId: string, opts: { trash?: boolean } = {}): Promise<DesignFile[]> {
  return getDb()
    .select()
    .from(schema.designFiles)
    .where(
      and(
        eq(schema.designFiles.projectId, projectId),
        eq(schema.designFiles.archived, false),
        opts.trash ? isNotNull(schema.designFiles.trashedAt) : isNull(schema.designFiles.trashedAt),
      ),
    )
    .orderBy(desc(schema.designFiles.updatedAt));
}

async function folderBelongs(projectId: string, folderId: string | null): Promise<string | null> {
  if (!folderId) return null;
  const [f] = await getDb()
    .select({ id: schema.folders.id })
    .from(schema.folders)
    .where(and(eq(schema.folders.id, folderId), eq(schema.folders.projectId, projectId), isNull(schema.folders.trashedAt)));
  if (!f) throw new HttpError(404, "dossier introuvable");
  return f.id;
}

/**
 * New file: committed to git first, then written as the tenant's `current.op` (the tenant has
 * never been loaded by the editor, so the host cannot overwrite it).
 */
export async function createFile(
  actor: Identity,
  project: Project,
  input: { name: unknown; folderId?: unknown; document?: string; fig?: { name: string; bytes: Buffer } },
): Promise<DesignFile> {
  const name = cleanName(input.name);
  const folderId = await folderBelongs(project.id, typeof input.folderId === "string" ? input.folderId : null);
  const db = getDb();
  const tenantId = newTenantId();
  let doc = input.document ?? EMPTY_DOCUMENT;
  if (input.fig) {
    // The converter lives in the host. Throwaway tenant: the file's own tenant must stay
    // unknown to the host until its first open (see spec §7).
    doc = await convertFig(newTenantId(), actor.username, input.fig.name, input.fig.bytes).catch(() => {
      throw new HttpError(400, "import .fig impossible");
    });
  }
  if (!isOpDocument(doc)) throw new HttpError(400, "document .op / .pen invalide");
  const [me] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, actor.username));
  const [file] = await db
    .insert(schema.designFiles)
    .values({ projectId: project.id, folderId, name, tenantId, screenCount: countScreens(doc), createdBy: me?.id ?? null })
    .returning();
  if (!file) throw new HttpError(500, "création impossible");
  const target = tenantDocumentPath(env.editorDataDir, tenantId);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, doc, { mode: 0o600 });
  await commitFile(env.projectsDir, project.slug, file.id, doc, authorFor(actor.username), `création : ${name}`);
  await logActivity(project.id, actor.username, "file.created", { kind: "file", name });
  return file;
}

export async function patchFile(
  actor: Identity,
  project: Project,
  file: DesignFile,
  input: { name?: unknown; folderId?: unknown },
): Promise<DesignFile> {
  const set: Partial<typeof schema.designFiles.$inferInsert> = {};
  if (input.name !== undefined) set.name = cleanName(input.name);
  if (input.folderId !== undefined) set.folderId = await folderBelongs(project.id, typeof input.folderId === "string" ? input.folderId : null);
  if (Object.keys(set).length === 0) return file;
  const [row] = await getDb().update(schema.designFiles).set(set).where(eq(schema.designFiles.id, file.id)).returning();
  await logActivity(project.id, actor.username, set.name ? "file.renamed" : "file.moved", { kind: "file", name: row?.name ?? file.name });
  return row ?? file;
}

export async function trashFile(actor: Identity, project: Project, file: DesignFile, restore = false): Promise<void> {
  await snapshotIfOpen(file, project, actor.username).catch(() => undefined);
  const set = restore ? { trashedAt: null } : { trashedAt: new Date() };
  await getDb().update(schema.designFiles).set(set).where(eq(schema.designFiles.id, file.id));
  await logActivity(project.id, actor.username, restore ? "file.restored" : "file.trashed", { kind: "file", name: file.name });
}

export async function duplicateFile(actor: Identity, project: Project, file: DesignFile): Promise<DesignFile> {
  const doc = (await snapshotFile(file, project, actor.username, "avant duplication").then((r) => r.document).catch(() => null)) ?? (await readHead(env.projectsDir, project.slug, file.id));
  if (!doc) throw new HttpError(409, "fichier vide");
  return createFile(actor, project, { name: `${file.name} (copie)`, folderId: file.folderId, document: doc });
}

/** Permanently drop files trashed for more than TRASH_DAYS (history stays in git). */
export async function purgeExpired(project: Project): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - TRASH_DAYS * 86_400_000);
  const old = await db
    .select()
    .from(schema.designFiles)
    .where(and(eq(schema.designFiles.projectId, project.id), isNotNull(schema.designFiles.trashedAt), lt(schema.designFiles.trashedAt, cutoff)));
  for (const f of old) {
    await removeFile(env.projectsDir, project.slug, f.id, authorFor("edub-design"));
    await db.delete(schema.designFiles).where(eq(schema.designFiles.id, f.id));
  }
  return old.length;
}

/* ───────────── versions (git) ───────────── */

export type SnapshotResult = { sha: string | null; document: string };

/** Pull the live document from the editor and commit it (no commit when nothing changed). */
export async function snapshotFile(file: DesignFile, project: Project, username: string, message?: string): Promise<SnapshotResult> {
  const document = await fetchDocument(file.tenantId, username);
  if (!isOpDocument(document)) throw new HttpError(502, "document éditeur invalide");
  const sha = await commitFile(env.projectsDir, project.slug, file.id, document, authorFor(username), message ?? `enregistrement : ${file.name}`);
  if (sha) {
    await getDb()
      .update(schema.designFiles)
      .set({ updatedAt: new Date(), screenCount: countScreens(document) })
      .where(eq(schema.designFiles.id, file.id));
    await logActivity(project.id, username, "file.saved", { kind: "file", name: file.name }, { sha: sha.slice(0, 8) }, 10 * 60_000);
  }
  return { sha, document };
}

async function snapshotIfOpen(file: DesignFile, project: Project, username: string) {
  await snapshotFile(file, project, username, `enregistrement : ${file.name}`);
}

export async function versionsOf(project: Project, file: DesignFile): Promise<Version[]> {
  return listVersions(env.projectsDir, project.slug, file.id);
}

/** Put an older version back as the live document, as a NEW commit (history is never rewritten). */
export async function restoreVersion(actor: Identity, project: Project, file: DesignFile, sha: string): Promise<string | null> {
  const old = await readVersion(env.projectsDir, project.slug, file.id, sha).catch(() => {
    throw new HttpError(404, "version introuvable");
  });
  await snapshotFile(file, project, actor.username, "avant restauration").catch(() => undefined);
  await pushDocument(file.tenantId, actor.username, old);
  const newSha = await commitFile(env.projectsDir, project.slug, file.id, old, authorFor(actor.username), `restauration de ${sha.slice(0, 8)}`);
  await getDb()
    .update(schema.designFiles)
    .set({ updatedAt: new Date(), screenCount: countScreens(old) })
    .where(eq(schema.designFiles.id, file.id));
  await logActivity(project.id, actor.username, "file.version-restored", { kind: "file", name: file.name }, { from: sha.slice(0, 8) });
  return newSha;
}

/** Debounced snapshot after editor writes: one commit ~20 s after the last write burst. */
const timers = new Map<string, NodeJS.Timeout>();
export function scheduleSnapshot(fileId: string, tenant: string, username: string, delayMs = 20_000): void {
  const prev = timers.get(tenant);
  if (prev) clearTimeout(prev);
  const t = setTimeout(async () => {
    timers.delete(tenant);
    try {
      const [row] = await getDb()
        .select({ file: schema.designFiles, project: schema.projects })
        .from(schema.designFiles)
        .innerJoin(schema.projects, eq(schema.projects.id, schema.designFiles.projectId))
        .where(eq(schema.designFiles.id, fileId));
      if (row && !row.file.trashedAt) await snapshotFile(row.file, row.project, username);
    } catch (e) {
      console.error("debounced snapshot failed", e instanceof Error ? e.message : e);
    }
  }, delayMs);
  t.unref();
  timers.set(tenant, t);
}

/* ───────────── thumbnails ───────────── */

const thumbDir = () => path.join(env.projectsDir, ".thumbs");

/** PNG of the file's first page, cached per (file, updatedAt). null = not renderable yet. */
export async function thumbnailFor(file: DesignFile, project: Project, username: string): Promise<Buffer | null> {
  const key = `${file.id}-${file.updatedAt.getTime()}.png`;
  const cached = path.join(thumbDir(), key);
  try {
    return await readFile(cached);
  } catch {
    /* miss */
  }
  const doc = await readHead(env.projectsDir, project.slug, file.id);
  if (!doc) return null;
  try {
    const png = await renderPng(file.tenantId, username, doc);
    await mkdir(thumbDir(), { recursive: true, mode: 0o700 });
    for (const old of await readdir(thumbDir())) if (old.startsWith(file.id) && old !== key) await rm(path.join(thumbDir(), old), { force: true });
    await writeFile(cached, png);
    return png;
  } catch {
    return null;
  }
}


