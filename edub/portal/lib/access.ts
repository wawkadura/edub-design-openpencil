import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "./db/index.ts";
import type { Identity } from "./identity.ts";
import type { DesignFile, Member, Project, ProjectRole, User } from "./db/schema.ts";
import { resolveRole, SLUG_RE } from "./rights.ts";

/** Mirror the Authelia identity into `user` (insert or refresh). */
export async function upsertUser(identity: Identity): Promise<User> {
  const db = getDb();
  const [row] = await db
    .insert(schema.users)
    .values({
      username: identity.username,
      displayName: identity.displayName,
      email: identity.email,
      groups: identity.groups,
    })
    .onConflictDoUpdate({
      target: schema.users.username,
      set: {
        displayName: identity.displayName,
        email: identity.email,
        groups: identity.groups,
        lastSeenAt: new Date(),
      },
    })
    .returning();
  if (!row) throw new Error("user upsert returned nothing");
  return row;
}

export async function membersOf(projectId: string): Promise<Member[]> {
  return getDb().select().from(schema.projectMembers).where(eq(schema.projectMembers.projectId, projectId));
}

export async function roleOnProject(identity: Identity, projectId: string): Promise<ProjectRole | null> {
  return resolveRole(identity, await membersOf(projectId));
}

export type ProjectAccess = { project: Project; role: ProjectRole };

/** The project, only if the caller has a role on it. null = "does not exist" for them (404). */
export async function projectForIdentity(identity: Identity, slug: string): Promise<ProjectAccess | null> {
  if (!SLUG_RE.test(slug)) return null; // also keeps NUL bytes etc. away from Postgres (would be a 500)
  const [project] = await getDb().select().from(schema.projects).where(eq(schema.projects.slug, slug)).limit(1);
  if (!project) return null;
  const role = await roleOnProject(identity, project.id);
  return role ? { project, role } : null;
}

export type FileAccess = { file: DesignFile; project: Project; role: ProjectRole };

/** The live file, only if the caller has a role on its project (archived project: owners/admin only). */
export async function fileForIdentity(identity: Identity, fileId: string): Promise<FileAccess | null> {
  if (!/^[0-9a-f-]{36}$/.test(fileId)) return null;
  const [row] = await getDb()
    .select({ file: schema.designFiles, project: schema.projects })
    .from(schema.designFiles)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.designFiles.projectId))
    .where(eq(schema.designFiles.id, fileId))
    .limit(1);
  if (!row) return null;
  const role = await roleOnProject(identity, row.project.id);
  return role ? { ...row, role } : null;
}

/** Editor gate: access of `identity` to the file holding editor tenant `tenantId` (null = none). */
export async function accessForTenant(identity: Identity, tenantId: string): Promise<FileAccess | null> {
  const [row] = await getDb()
    .select({ file: schema.designFiles, project: schema.projects })
    .from(schema.designFiles)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.designFiles.projectId))
    .where(
      and(
        eq(schema.designFiles.tenantId, tenantId),
        eq(schema.designFiles.archived, false),
        isNull(schema.designFiles.trashedAt),
        eq(schema.projects.archived, false),
      ),
    )
    .limit(1);
  if (!row) return null;
  const role = await roleOnProject(identity, row.project.id);
  return role ? { ...row, role } : null;
}

export async function roleForTenant(identity: Identity, tenantId: string): Promise<ProjectRole | null> {
  return (await accessForTenant(identity, tenantId))?.role ?? null;
}

export type ProjectCard = {
  project: Project;
  role: ProjectRole;
  fileCount: number;
  screenCount: number;
  members: Member[];
  /** Most recently modified live file (thumbnail source). */
  latestFile: DesignFile | null;
};

/** Projects the caller may see, with the numbers the home grid shows. Others do not exist for them. */
export async function visibleProjects(identity: Identity, opts: { archived?: boolean } = {}): Promise<ProjectCard[]> {
  const db = getDb();
  const projects = await db.select().from(schema.projects).where(eq(schema.projects.archived, opts.archived ?? false));
  if (projects.length === 0) return [];
  const ids = projects.map((p) => p.id);
  const members = await db.select().from(schema.projectMembers).where(inArray(schema.projectMembers.projectId, ids));
  const out: ProjectCard[] = [];
  const mine = new Map<string, { project: Project; role: ProjectRole; members: Member[] }>();
  for (const p of projects) {
    const ms = members.filter((m) => m.projectId === p.id);
    const role = resolveRole(identity, ms);
    if (role) mine.set(p.id, { project: p, role, members: ms });
  }
  if (mine.size === 0) return [];
  const files = await db
    .select()
    .from(schema.designFiles)
    .where(
      and(
        inArray(schema.designFiles.projectId, [...mine.keys()]),
        eq(schema.designFiles.archived, false),
        isNull(schema.designFiles.trashedAt),
      ),
    );
  for (const [id, m] of mine) {
    const fs = files.filter((f) => f.projectId === id);
    const latest = [...fs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
    out.push({
      project: m.project,
      role: m.role,
      fileCount: fs.length,
      screenCount: fs.reduce((n, f) => n + f.screenCount, 0),
      members: m.members,
      latestFile: latest,
    });
  }
  return out.sort((a, b) => a.project.name.localeCompare(b.project.name, "fr"));
}
