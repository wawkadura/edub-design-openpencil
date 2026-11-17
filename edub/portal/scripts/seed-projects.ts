/**
 * Idempotent starter projects: one per Edub app (emoji + colour), owner = Walid only,
 * each with an empty « État actuel — 2026-11 » screen section ready for the first captures.
 * GolfN is created empty (no section): Walid decides what goes in it.
 *
 * Usage (prod, as the portal user):  npm run seed:projects
 * Owner defaults to the Authelia user `edub`; override with EDUB_DESIGN_SEED_OWNER.
 * Existing projects are never modified (Walid may have renamed or recoloured them).
 */
import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../lib/db/schema.ts";

export const SECTION_NAME = "État actuel — 2026-11";

export type SeedProject = { slug: string; name: string; emoji: string; color: string; description: string; section: boolean };

export const SEED_PROJECTS: SeedProject[] = [
  { slug: "edub-dev", name: "Edub Dev", emoji: "🛠️", color: "#6366f1", description: "Tableau de bord dev : tickets, sessions et flotte d'agents.", section: true },
  { slug: "edub-sql", name: "Edub SQL", emoji: "🗄️", color: "#0ea5e9", description: "Client SQL maison (fork Edub SQL).", section: true },
  { slug: "edub-todo", name: "Edub Todo", emoji: "✅", color: "#22c55e", description: "Todo personnelle.", section: true },
  { slug: "edub-knowledge", name: "Edub Knowledge", emoji: "📚", color: "#f59e0b", description: "Notes, livres et fil d'actualité.", section: true },
  { slug: "edub-finance", name: "Edub Finance", emoji: "💶", color: "#10b981", description: "Suivi des finances (éviter les montants dans les captures).", section: true },
  { slug: "edub-tv", name: "Edub TV", emoji: "📺", color: "#ef4444", description: "Télé et médias.", section: true },
  { slug: "edub-travels", name: "Edub Travels", emoji: "✈️", color: "#14b8a6", description: "Voyages partageables en lecture seule.", section: true },
  { slug: "edub-games", name: "Edub Games", emoji: "🎮", color: "#a855f7", description: "Jeux (en construction).", section: true },
  { slug: "edub-console", name: "Edub Console", emoji: "🖥️", color: "#64748b", description: "Console d'administration.", section: true },
  { slug: "edub-watch", name: "Edub Watch", emoji: "⌚", color: "#f97316", description: "Apps montre.", section: true },
  { slug: "edub-design", name: "Edub Design", emoji: "🎨", color: "#ec4899", description: "Cet outil : portail, éditeur, galerie d'écrans.", section: true },
  { slug: "tamafit", name: "TamaFit", emoji: "🥚", color: "#f43f5e", description: "App TamaFit (mobile) : captures de QA et maquettes des agents TamaFit.", section: true },
  { slug: "golfn", name: "GolfN", emoji: "⛳", color: "#84cc16", description: "Projet vide : à Walid de décider.", section: false },
];

export async function seedProjects(db: ReturnType<typeof drizzle<typeof schema>>, owner: string, log: (m: string) => void = console.log): Promise<{ created: number; existing: number }> {
  const [me] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.username, owner));
  let created = 0;
  let existing = 0;
  for (const p of SEED_PROJECTS) {
    const [found] = await db.select().from(schema.projects).where(eq(schema.projects.slug, p.slug));
    let project = found;
    if (project) existing++;
    else {
      [project] = await db
        .insert(schema.projects)
        .values({ slug: p.slug, name: p.name, emoji: p.emoji, color: p.color, description: p.description, createdBy: me?.id ?? null })
        .returning();
      if (!project) throw new Error(`insert failed: ${p.slug}`);
      created++;
      log(`+ ${p.name}`);
    }
    // Owner only; never add or remove other members (Walid may have shared it since).
    await db.insert(schema.projectMembers).values({ projectId: project.id, principalKind: "user", principal: owner, role: "owner" }).onConflictDoNothing();
    if (!found) await db.insert(schema.activities).values({ projectId: project.id, actor: owner, action: "project.created", targetKind: "project", targetName: p.name });
    if (p.section && !found) {
      const [has] = await db
        .select({ id: schema.screenSections.id })
        .from(schema.screenSections)
        .where(and(eq(schema.screenSections.projectId, project.id), eq(schema.screenSections.name, SECTION_NAME)));
      if (!has) await db.insert(schema.screenSections).values({ projectId: project.id, name: SECTION_NAME, position: 0 });
    }
  }
  return { created, existing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  config({ path: ".env.local", quiet: true });
  const url = process.env.EDUB_DESIGN_DATABASE_URL;
  if (!url) throw new Error("missing EDUB_DESIGN_DATABASE_URL");
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const owner = process.env.EDUB_DESIGN_SEED_OWNER ?? "edub";
  const r = await seedProjects(drizzle({ client: pool, schema }), owner);
  console.log(`seed-projects OK: ${r.created} créés, ${r.existing} déjà présents (owner ${owner})`);
  await pool.end();
}
