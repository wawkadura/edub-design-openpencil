import { sql } from "drizzle-orm";
import { boolean, index, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectRole = pgEnum("project_role", ["owner", "editor", "viewer"]);

export const projectMembers = pgTable(
  "project_member",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: projectRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index("project_member_user_idx").on(t.userId)],
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
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("design_file_project_idx").on(t.projectId)],
);

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type DesignFile = typeof designFiles.$inferSelect;
export type ProjectRole = (typeof projectRole.enumValues)[number];
