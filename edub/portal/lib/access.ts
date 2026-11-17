import { and, eq } from "drizzle-orm";
import { getDb, schema } from "./db/index.ts";
import { isAdmin, type Identity } from "./identity.ts";
import type { DesignFile, ProjectRole, User } from "./db/schema.ts";

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

/** Role of `identity` on the project holding editor tenant `tenantId`, or null. */
export async function roleForTenant(identity: Identity, tenantId: string): Promise<ProjectRole | null> {
  const db = getDb();
  const [file] = await db
    .select({ projectId: schema.designFiles.projectId })
    .from(schema.designFiles)
    .where(and(eq(schema.designFiles.tenantId, tenantId), eq(schema.designFiles.archived, false)))
    .limit(1);
  if (!file) return null;
  if (isAdmin(identity)) return "owner";
  const [member] = await db
    .select({ role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(and(eq(schema.projectMembers.projectId, file.projectId), eq(schema.users.username, identity.username)))
    .limit(1);
  return member?.role ?? null;
}

export type VisibleFile = DesignFile & { projectName: string; projectSlug: string; role: ProjectRole };

/** Files the user may open, grouped by project order then name. */
export async function visibleFiles(identity: Identity): Promise<VisibleFile[]> {
  const db = getDb();
  const rows = await db
    .select({ file: schema.designFiles, project: schema.projects })
    .from(schema.designFiles)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.designFiles.projectId))
    .where(eq(schema.designFiles.archived, false))
    .orderBy(schema.projects.name, schema.designFiles.name);
  if (isAdmin(identity)) {
    return rows.map((r) => ({ ...r.file, projectName: r.project.name, projectSlug: r.project.slug, role: "owner" }));
  }
  const memberships = await db
    .select({ projectId: schema.projectMembers.projectId, role: schema.projectMembers.role })
    .from(schema.projectMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
    .where(eq(schema.users.username, identity.username));
  const roles = new Map(memberships.map((m) => [m.projectId, m.role]));
  return rows.flatMap((r) => {
    const role = roles.get(r.project.id);
    return role ? [{ ...r.file, projectName: r.project.name, projectSlug: r.project.slug, role }] : [];
  });
}
