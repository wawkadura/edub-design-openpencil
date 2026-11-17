/**
 * Idempotent demo seed: project « Démo » + file « Lumina landing » whose editor
 * document is the upstream sample `lumina-landing.op`. Run by edub/scripts/deploy.sh.
 */
import { config } from "dotenv";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../lib/db/schema.ts";
import { newTenantId, tenantDocumentPath } from "../lib/tenant-store.ts";

config({ path: ".env.local", quiet: true });
const url = process.env.EDUB_DESIGN_DATABASE_URL;
const dataDir = process.env.EDUB_DESIGN_EDITOR_DATA_DIR;
if (!url || !dataDir) throw new Error("missing EDUB_DESIGN_DATABASE_URL or EDUB_DESIGN_EDITOR_DATA_DIR");

const pool = new pg.Pool({ connectionString: url, max: 1 });
const db = drizzle({ client: pool, schema });

const [existing] = await db.select().from(schema.projects).where(eq(schema.projects.slug, "demo"));
const project =
  existing ??
  (await db.insert(schema.projects).values({ slug: "demo", name: "Démo" }).returning())[0];
if (!project) throw new Error("demo project insert failed");

let [file] = await db.select().from(schema.designFiles).where(eq(schema.designFiles.projectId, project.id));
if (!file) {
  [file] = await db
    .insert(schema.designFiles)
    .values({ projectId: project.id, name: "Lumina landing", tenantId: newTenantId() })
    .returning();
}
if (!file) throw new Error("demo file insert failed");

const target = tenantDocumentPath(dataDir, file.tenantId);
if (!existsSync(target)) {
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  copyFileSync(path.resolve("../../lumina-landing.op"), target);
  console.log(`demo document written for ${file.tenantId}`);
}
console.log(`demo OK: /editor?tenant=${file.tenantId}`);
await pool.end();
