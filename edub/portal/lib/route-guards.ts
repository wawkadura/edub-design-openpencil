import { fileForIdentity, projectForIdentity, type FileAccess, type ProjectAccess } from "./access.ts";
import { handle, notFound } from "./api.ts";
import type { Identity } from "./identity.ts";
import { HttpError } from "./projects.ts";
import { canWrite } from "./rights.ts";

/** Route helpers: 404 for "no right at all", 403 for "you may look but not do this". */
export function withProject(
  req: Request,
  slug: Promise<{ slug: string }>,
  opts: { write?: boolean },
  fn: (me: Identity, access: ProjectAccess) => Promise<Response>,
) {
  return handle(req, async (me) => {
    const access = await projectForIdentity(me, (await slug).slug);
    if (!access) return notFound();
    if (opts.write && !canWrite(access.role)) throw new HttpError(403, "lecture seule");
    return fn(me, access);
  });
}

export function withFile(
  req: Request,
  params: Promise<{ id: string }>,
  opts: { write?: boolean },
  fn: (me: Identity, access: FileAccess) => Promise<Response>,
) {
  return handle(req, async (me) => {
    const access = await fileForIdentity(me, (await params).id);
    if (!access) return notFound();
    if (opts.write && !canWrite(access.role)) throw new HttpError(403, "lecture seule");
    return fn(me, access);
  });
}
