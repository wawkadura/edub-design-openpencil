import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Edub Design data model (spec: docs/edub/2026-11-16-edub-design-spec.md §Modèle de droits).
 * Identity comes from Authelia; `user` is an upserted mirror, never a credential store.
 */
export const users = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  displayName: text("display_name"),
  email: text("email"),
  groups: text("groups").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One app (TamaFit, GolfN, Edub Games…) = one project; rights are granted per project. */
export const projects = pgTable("project", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  emoji: text("emoji"),
  color: text("color"),
  description: text("description"),
  archived: boolean("archived").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectRole = pgEnum("project_role", ["owner", "editor", "viewer"]);

/** A member is an Authelia user (`Remote-User`) or an Authelia group (`Remote-Groups`). */
export const principalKind = pgEnum("principal_kind", ["user", "group"]);

export const projectMembers = pgTable(
  "project_member",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    principalKind: principalKind("principal_kind").notNull(),
    principal: text("principal").notNull(),
    role: projectRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.principalKind, t.principal] }),
    index("project_member_principal_idx").on(t.principalKind, t.principal),
  ],
);

/** Folder tree inside a project (files live in `design_file.folder_id`). */
export const folders = pgTable(
  "folder",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => folders.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("folder_project_idx").on(t.projectId)],
);

/**
 * A `.op` design file. `tenantId` (`f_<32 hex>`) is the editor tenant that holds it:
 * the Rust host stores it under `<data>/editor/<sha256(tenantId)[..16]>/current.op`.
 */
export const designFiles = pgTable(
  "design_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tenantId: text("tenant_id").notNull().unique(),
    archived: boolean("archived").notNull().default(false),
    folderId: uuid("folder_id").references(() => folders.id, { onDelete: "set null" }),
    /** Set = in the trash (purged after 30 days). */
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    /** Frames (screens) counted at the last snapshot. */
    screenCount: integer("screen_count").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("design_file_project_idx").on(t.projectId)],
);

/** Who did what in a project (opened / saved / shared …). `actor` is the Authelia username. */
export const activities = pgTable(
  "activity",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetKind: text("target_kind"),
    targetName: text("target_name"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activity_project_idx").on(t.projectId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type DesignFile = typeof designFiles.$inferSelect;
export type ProjectRole = (typeof projectRole.enumValues)[number];
export type Folder = typeof folders.$inferSelect;
export type Member = typeof projectMembers.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type PrincipalKind = (typeof principalKind.enumValues)[number];
