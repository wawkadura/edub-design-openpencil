import { json } from "@/lib/api.ts";
import { withProject } from "@/lib/route-guards.ts";
import { createScreen, listScreens, projectTags } from "@/lib/screens.ts";
import { readScreenInput } from "@/lib/screens-input.ts";
import { screenJson } from "@/lib/screens-route.ts";

export const dynamic = "force-dynamic";

/** `?q=&platform=&status=&tag=&ticket=ED_1234&section=<id|none>&type=&sort=recent|oldest|title|status&page=&pageSize=` */
export const GET = (req: Request, { params }: { params: Promise<{ slug: string }> }) =>
  withProject(req, params, {}, async (_me, { project }) => {
    const sp = new URL(req.url).searchParams;
    const g = (k: string) => sp.get(k) ?? undefined;
    const res = await listScreens(project, {
      q: g("q"), platform: g("platform"), status: g("status"), tag: g("tag"), ticket: g("ticket"), type: g("type"), sort: g("sort"),
      sectionId: g("section"), page: Number(g("page") ?? 1) || 1, pageSize: Number(g("pageSize") ?? 60) || 60,
    });
    return json({ ok: true, total: res.total, page: res.page, pageSize: res.pageSize, tags: await projectTags(project.id), screens: res.items.map((s) => screenJson(project, s)) });
  });

/**
 * New screen (first version). multipart: `file` + `title? sectionId? platform? type? status? tags? description? links? agent?`;
 * JSON: same fields + `filename` and `contentBase64`. type `design`: JSON `{type:"design", designFileId, frameId?}` (no file).
 */
export const POST = (req: Request, { params }: { params: Promise<{ slug: string }> }) =>
  withProject(req, params, { write: true }, async (me, { project }) => {
    const { fields, upload } = await readScreenInput(req);
    return json({ ok: true, screen: screenJson(project, await createScreen(me, project, fields, upload)) }, 201);
  });
