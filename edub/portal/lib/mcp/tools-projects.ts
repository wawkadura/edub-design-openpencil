import { and, count, eq, ilike, isNull, or } from "drizzle-orm";
import { getDb, schema } from "../db/index.ts";
import { listFiles } from "../projects.ts";
import { listScreens, listSections } from "../screens.ts";
import { visibleProjectsForToken } from "./auth.ts";
import { json, needProject, PROJECT_ARG, str, type Tool } from "./kit.ts";

export const projectTools: Tool[] = [
  {
    name: "list_projects",
    description: "List the Edub Design projects this token can see, with the token's role on each (viewer or editor). Projects outside the token's scopes do not exist for it.",
    inputSchema: { type: "object", properties: {} },
    async run(ctx) {
      const items = await visibleProjectsForToken(ctx.token);
      return json({
        projects: items.map(({ project, role }) => ({ slug: project.slug, name: project.name, emoji: project.emoji, description: project.description, role })),
      });
    },
  },
  {
    name: "get_project",
    description: "Project details: description, the token's role, screen sections and the number of design files and gallery screens.",
    inputSchema: { type: "object", properties: { project: PROJECT_ARG }, required: ["project"] },
    async run(ctx, args) {
      const { project, role } = await needProject(ctx, args, false);
      const db = getDb();
      const [screens] = await db.select({ n: count() }).from(schema.screens).where(eq(schema.screens.projectId, project.id));
      const files = await listFiles(project.id);
      return json({
        slug: project.slug,
        name: project.name,
        emoji: project.emoji,
        description: project.description,
        role,
        fileCount: files.length,
        screenCount: screens?.n ?? 0,
        sections: (await listSections(project.id)).map((s) => ({ id: s.id, name: s.name, parentId: s.parentId, screens: s.count })),
      });
    },
  },
  {
    name: "search",
    description: "Search gallery screens (title, description, tags, tickets) and design files (name) by text. Omit `project` to search every project the token can see.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Text to look for (a ticket id like ED_1234 works)." }, project: { ...PROJECT_ARG, description: "Optional: limit to one project slug." } },
      required: ["query"],
    },
    async run(ctx, args) {
      const q = str(args, "query", true)!.trim();
      const scoped = args.project !== undefined ? [await needProject(ctx, args, false)] : await visibleProjectsForToken(ctx.token);
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const out: { screens: unknown[]; files: unknown[] } = { screens: [], files: [] };
      for (const { project } of scoped) {
        const res = await listScreens(project, { q, pageSize: 20 });
        for (const s of res.items) out.screens.push({ project: project.slug, id: s.id, title: s.title, platform: s.platform, status: s.status, tags: s.tags, tickets: s.tickets });
        const files = await getDb()
          .select()
          .from(schema.designFiles)
          .where(and(eq(schema.designFiles.projectId, project.id), isNull(schema.designFiles.trashedAt), eq(schema.designFiles.archived, false), or(ilike(schema.designFiles.name, like))));
        for (const f of files.slice(0, 20)) out.files.push({ project: project.slug, id: f.id, name: f.name });
      }
      return json(out);
    },
  },
];
