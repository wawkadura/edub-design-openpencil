import { json, bodyOf } from "@/lib/api.ts";
import { deleteScreen, getScreen, updateScreen } from "@/lib/screens.ts";
import { screenJson, versionJson, withScreen } from "@/lib/screens-route.ts";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ slug: string; sid: string }> };

export const GET = (req: Request, { params }: P) =>
  withScreen(req, params, {}, async (_me, { project }, s) => json({ ok: true, screen: screenJson(project, s), versions: s.versions.map((v) => versionJson(project, s, v)) }));

export const PATCH = (req: Request, { params }: P) =>
  withScreen(req, params, { write: true }, async (me, { project }, s) => {
    await updateScreen(me, project, s, await bodyOf(req));
    return json({ ok: true, screen: screenJson(project, (await getScreen(project, s.id))!) });
  });

export const DELETE = (req: Request, { params }: P) =>
  withScreen(req, params, { write: true }, async (me, { project }, s) => {
    await deleteScreen(me, project, s);
    return json({ ok: true });
  });
