import { json, bodyOf } from "@/lib/api.ts";
import { withProject } from "@/lib/route-guards.ts";
import { createSection, listSections } from "@/lib/screens.ts";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string }> };

export const GET = (req: Request, { params }: P) => withProject(req, params, {}, async (_me, { project }) => json({ ok: true, sections: await listSections(project.id) }));

/** `{ name, parentId? }` — one level of nesting. */
export const POST = (req: Request, { params }: P) =>
  withProject(req, params, { write: true }, async (me, { project }) => json({ ok: true, section: await createSection(me, project, await bodyOf(req)) }, 201));
