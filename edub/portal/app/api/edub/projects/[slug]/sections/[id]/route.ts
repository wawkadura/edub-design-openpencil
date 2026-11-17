import { json, bodyOf } from "@/lib/api.ts";
import { withProject } from "@/lib/route-guards.ts";
import { deleteSection, updateSection } from "@/lib/screens.ts";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string; id: string }> };

/** `{ name?, position?, parentId? }` (reorder = set `position`). */
export const PATCH = (req: Request, { params }: P) =>
  withProject(req, params, { write: true }, async (me, { project }) => json({ ok: true, section: await updateSection(me, project, (await params).id, await bodyOf(req)) }));

/** Screens of the section are kept, unsorted. */
export const DELETE = (req: Request, { params }: P) =>
  withProject(req, params, { write: true }, async (me, { project }) => {
    await deleteSection(me, project, (await params).id);
    return json({ ok: true });
  });
