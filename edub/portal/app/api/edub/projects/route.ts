import { visibleProjects } from "@/lib/access.ts";
import { bodyOf, handle, json } from "@/lib/api.ts";
import { isAdmin } from "@/lib/identity.ts";
import { createProject, HttpError } from "@/lib/projects.ts";
import { SLUG_RE, slugify } from "@/lib/rights.ts";

export const dynamic = "force-dynamic";

/** Projects the caller can see (and only those). */
export const GET = (req: Request) =>
  handle(req, async (me) => {
    const cards = await visibleProjects(me);
    return json({
      ok: true,
      projects: cards.map((c) => ({
        slug: c.project.slug,
        name: c.project.name,
        emoji: c.project.emoji,
        color: c.project.color,
        description: c.project.description,
        role: c.role,
        fileCount: c.fileCount,
        screenCount: c.screenCount,
        memberCount: c.members.length,
      })),
    });
  });

/** Create a project (admin only); the creator becomes its owner. */
export const POST = (req: Request) =>
  handle(req, async (me) => {
    if (!isAdmin(me)) throw new HttpError(403, "création réservée à l'admin");
    const project = await createProject(me, await bodyOf(req), slugify, SLUG_RE);
    return json({ ok: true, project: { slug: project.slug, name: project.name } }, 201);
  });
