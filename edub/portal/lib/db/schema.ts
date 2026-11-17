import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, real, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

/* ───────────── Screen gallery (ED_1731) ───────────── */

/** A feature / user journey (Onboarding, Paywall…); nestable one level, ordered by `position`. */
export const screenSections = pgTable(
  "screen_section",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => screenSections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Markdown note of the section (imports: the `README.md` of the source folder). */
    description: text("description").notNull().default(""),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("screen_section_project_idx").on(t.projectId)],
);

export type ScreenLink = { type: "ticket" | "pr" | "url"; ref?: string; url?: string; label?: string };

/**
 * One screen of an app. `platform`, `type` and `status` are validated in lib/screens-model.ts
 * (plain text columns: adding a value never needs a migration).
 */
export const screens = pgTable(
  "screen",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sectionId: uuid("section_id").references(() => screenSections.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    platform: text("platform").notNull().default("autre"),
    type: text("type").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("proposé"),
    links: jsonb("links").$type<ScreenLink[]>().notNull().default(sql`'[]'::jsonb`),
    /** `ED_xxxx` ids found in `links` (indexed copy for the "screens of ticket X" filter). */
    tickets: text("tickets").array().notNull().default(sql`'{}'::text[]`),
    /** type `design`: the `.op` file and the frame it points to. */
    designFileId: uuid("design_file_id").references(() => designFiles.id, { onDelete: "set null" }),
    frameId: text("frame_id"),
    authorKind: text("author_kind").notNull().default("user"),
    author: text("author").notNull(),
    currentVersion: integer("current_version").notNull().default(0),
    /** Imports: POSIX path in the source tree, the idempotency key (also locates the mockup's relative assets). */
    sourceKey: text("source_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("screen_project_idx").on(t.projectId, t.updatedAt),
    index("screen_section_idx").on(t.sectionId),
    uniqueIndex("screen_source_key_idx").on(t.projectId, t.sourceKey).where(sql`${t.sourceKey} is not null`),
  ],
);

/** Every upload is a new version; the history is kept (comparison is built on it). */
export const screenVersions = pgTable(
  "screen_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    screenId: uuid("screen_id")
      .notNull()
      .references(() => screens.id, { onDelete: "cascade" }),
    n: integer("n").notNull(),
    kind: text("kind").notNull(),
    mime: text("mime").notNull(),
    ext: text("ext").notNull(),
    width: integer("width"),
    height: integer("height"),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    note: text("note"),
    authorKind: text("author_kind").notNull().default("user"),
    author: text("author").notNull(),
    hasThumb: boolean("has_thumb").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("screen_version_n_idx").on(t.screenId, t.n)],
);

export const screenComments = pgTable(
  "screen_comment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    screenId: uuid("screen_id")
      .notNull()
      .references(() => screens.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    body: text("body").notNull(),
    mentions: text("mentions").array().notNull().default(sql`'{}'::text[]`),
    /** Pin on the image, 0..1 of its width / height. */
    pinX: real("pin_x"),
    pinY: real("pin_y"),
    versionN: integer("version_n"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("screen_comment_idx").on(t.screenId, t.createdAt)],
);

/* ───────────── Agent MCP tokens (ED_1732) ───────────── */

/** One grant of a token: a project slug (or `*` = every project) at `viewer` or `editor` (never owner). */
export type TokenScope = { project: string; role: "viewer" | "editor" };

/** Bearer credential of an agent (`https://design.edub.fr/mcp`). Only the sha-256 is stored. */
export const mcpTokens = pgTable(
  "mcp_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    /** First characters of the secret, to recognise a token in the admin list. */
    prefix: text("prefix").notNull(),
    hash: text("hash").notNull().unique(),
    scopes: jsonb("scopes").$type<TokenScope[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
);

/** Journal of the MCP calls (who, which tool, which project, result). */
export const mcpCalls = pgTable(
  "mcp_call",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => mcpTokens.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    project: text("project"),
    ok: boolean("ok").notNull(),
    error: text("error"),
    ms: integer("ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mcp_call_token_idx").on(t.tokenId, t.createdAt)],
);

export type McpToken = typeof mcpTokens.$inferSelect;
export type McpCall = typeof mcpCalls.$inferSelect;

export type ScreenSection = typeof screenSections.$inferSelect;
export type Screen = typeof screens.$inferSelect;
export type ScreenVersion = typeof screenVersions.$inferSelect;
export type ScreenComment = typeof screenComments.$inferSelect;

export type User = typeof users.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type DesignFile = typeof designFiles.$inferSelect;
export type ProjectRole = (typeof projectRole.enumValues)[number];
export type Folder = typeof folders.$inferSelect;
export type Member = typeof projectMembers.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type PrincipalKind = (typeof principalKind.enumValues)[number];
