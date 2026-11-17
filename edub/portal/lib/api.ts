import { upsertUser } from "./access.ts";
import { currentIdentity } from "./current-user.ts";
import { env } from "./env.ts";
import { HttpError } from "./projects.ts";
import { canUseDesign, type Identity } from "./identity.ts";

/** Shared plumbing of the portal's JSON API (`/api/edub/*`, behind Authelia). */
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

/** Uniform 404 body: same answer whether the thing is missing or the caller has no right on it. */
export const notFound = () => json({ ok: false, error: "not_found" }, 404);

export async function authenticate(req: Request): Promise<Identity | Response> {
  const identity = await currentIdentity();
  if (!identity) return json({ ok: false, error: "unauthorized" }, 401);
  if (!canUseDesign(identity)) return json({ ok: false, error: "forbidden" }, 403);
  const method = req.method.toUpperCase();
  // CSRF boundary for portal mutations (the Authelia cookie is ambient).
  if (method !== "GET" && method !== "HEAD") {
    const origin = req.headers.get("origin");
    if (origin !== env.publicOrigin) return json({ ok: false, error: "cross_origin" }, 403);
  }
  await upsertUser(identity);
  return identity;
}

export async function handle(req: Request, fn: (identity: Identity) => Promise<Response>): Promise<Response> {
  const identity = await authenticate(req);
  if (identity instanceof Response) return identity;
  try {
    return await fn(identity);
  } catch (e) {
    if (e instanceof HttpError) return json({ ok: false, error: e.message }, e.status);
    console.error("api error", e);
    return json({ ok: false, error: "internal" }, 500);
  }
}

export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  try {
    const v = (await req.json()) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
