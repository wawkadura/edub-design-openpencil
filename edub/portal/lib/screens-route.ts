import type { ProjectAccess } from "./access.ts";
import { notFound } from "./api.ts";
import type { Project, Screen, ScreenVersion } from "./db/schema.ts";
import type { Identity } from "./identity.ts";
import { env } from "./env.ts";
import { withProject } from "./route-guards.ts";
import { getScreen, type ScreenItem } from "./screens.ts";
import { HTML_CSP, ticketUrl } from "./screens-model.ts";

/** Route plumbing + JSON shape of the gallery API (`/api/edub/projects/:slug/screens…`). */
export function withScreen(
  req: Request,
  params: Promise<{ slug: string; sid: string }>,
  opts: { write?: boolean },
  fn: (me: Identity, access: ProjectAccess, screen: ScreenItem & { versions: ScreenVersion[] }) => Promise<Response>,
) {
  return withProject(req, params, opts, async (me, access) => {
    const screen = await getScreen(access.project, (await params).sid);
    return screen ? fn(me, access, screen) : notFound();
  });
}

const base = (p: Project) => `/api/edub/projects/${p.slug}/screens`;

export function screenJson(project: Project, s: ScreenItem) {
  const urls = s.current
    ? { fileUrl: `${base(project)}/${s.id}/versions/current/file`, thumbUrl: `${base(project)}/${s.id}/versions/${s.current.n}/thumb` }
    : { fileUrl: null, thumbUrl: null };
  return {
    id: s.id,
    title: s.title,
    sectionId: s.sectionId,
    platform: s.platform,
    type: s.type,
    status: s.status,
    tags: s.tags,
    description: s.description,
    links: s.links.map((l) => (l.type === "ticket" && l.ref ? { ...l, url: ticketUrl(l.ref) } : l)),
    tickets: s.tickets,
    designFileId: s.designFileId,
    frameId: s.frameId,
    author: s.author,
    authorKind: s.authorKind,
    currentVersion: s.currentVersion,
    width: s.current?.width ?? null,
    height: s.current?.height ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    pageUrl: `/p/${project.slug}/screens/${s.id}`,
    shareUrl: `${env.publicOrigin}/p/${project.slug}/screens/${s.id}`,
    ...urls,
  };
}

export const versionJson = (project: Project, s: Screen, v: ScreenVersion) => ({
  n: v.n,
  kind: v.kind,
  mime: v.mime,
  width: v.width,
  height: v.height,
  bytes: v.bytes,
  sha256: v.sha256,
  note: v.note,
  author: v.author,
  authorKind: v.authorKind,
  createdAt: v.createdAt,
  current: v.n === s.currentVersion,
  fileUrl: `${base(project)}/${s.id}/versions/${v.n}/file`,
  thumbUrl: `${base(project)}/${s.id}/versions/${v.n}/thumb`,
});

/** Headers of a stored upload: never sniffed, never able to run in the portal origin. */
export function fileHeaders(v: ScreenVersion, immutable: boolean, download = false): Headers {
  const h = new Headers({
    "content-type": v.kind === "html" ? "text/html; charset=utf-8" : v.mime,
    "x-content-type-options": "nosniff",
    "content-security-policy": v.kind === "html" ? HTML_CSP : "sandbox; default-src 'none'; img-src 'self'",
    "cache-control": immutable ? "private, max-age=31536000, immutable" : "private, max-age=30, must-revalidate",
    etag: `"${v.sha256.slice(0, 32)}"`,
    "referrer-policy": "no-referrer",
  });
  if (download) h.set("content-disposition", `attachment; filename="screen-v${v.n}.${v.mime === "text/html" ? "html" : v.mime.split("/")[1]}"`);
  return h;
}
