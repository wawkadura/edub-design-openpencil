import { json, bodyOf } from "@/lib/api.ts";
import { addComment, listComments, mentionable } from "@/lib/screens.ts";
import { withScreen } from "@/lib/screens-route.ts";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string; sid: string }> };

export const GET = (req: Request, { params }: P) =>
  withScreen(req, params, {}, async (_me, { project }, s) => json({ ok: true, comments: await listComments(s.id), mentionable: await mentionable(project) }));

/** Any member (viewers included) may comment: `{ body, pinX?, pinY?, versionN? }` — `@user` mentions members only. */
export const POST = (req: Request, { params }: P) =>
  withScreen(req, params, {}, async (me, { project }, s) => json({ ok: true, comment: await addComment(me, project, s, await bodyOf(req)) }, 201));
