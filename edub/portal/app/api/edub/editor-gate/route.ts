import { identityFromAutheliaCookie } from "@/lib/authelia.ts";
import { accessForTenant, upsertUser } from "@/lib/access.ts";
import { mintEditorToken } from "@/lib/editor-token.ts";
import { env } from "@/lib/env.ts";
import { decide, parseOriginalUri } from "@/lib/gate.ts";
import { canUseDesign, isAdmin, parseDevUser, type Identity } from "@/lib/identity.ts";
import { isProduction } from "@/lib/env.ts";
import { logActivity, scheduleSnapshot } from "@/lib/projects.ts";

/**
 * nginx `auth_request` target for every editor API call (`/api/*` except the portal's
 * own routes). Reachable only through the internal nginx location
 * `/internal/edub-editor-gate`; the public path is refused by nginx.
 *
 * 200 + `X-Edub-Editor-Token` → nginx forwards the call with `Authorization: Bearer <token>`.
 * 401 → no Authelia session. 403 → no right on this file / disabled route / CSRF.
 */
export const dynamic = "force-dynamic";

const deny = (status: 401 | 403, reason: string) =>
  new Response(null, { status, headers: { "x-edub-gate-reason": reason, "cache-control": "no-store" } });

export async function GET(req: Request): Promise<Response> {
  const uri = req.headers.get("x-original-uri") ?? "";
  const method = req.headers.get("x-original-method") ?? "GET";
  const origin = req.headers.get("origin");
  const { path, tenant } = parseOriginalUri(uri);

  let identity: Identity | null;
  const devUser = isProduction ? null : req.headers.get("x-edub-dev-user");
  if (devUser) {
    // DEV/TEST only (never in production): impersonate per request, for end-to-end tests.
    identity = parseDevUser(devUser);
  } else {
    try {
      identity = await identityFromAutheliaCookie(
        env.autheliaUrl,
        req.headers.get("cookie"),
        `${env.publicOrigin}${uri}`,
        method,
      );
    } catch {
      return new Response(null, { status: 503 });
    }
  }
  if (!identity) return deny(401, "no-session");
  if (!canUseDesign(identity)) return deny(403, "not-in-design-group");

  const access = tenant ? await accessForTenant(identity, tenant) : null;
  const decision = decide({ method, path, tenant, origin, publicOrigin: env.publicOrigin, role: access?.role ?? null, admin: isAdmin(identity) });
  if (!decision.allow) return deny(decision.status, decision.reason);

  if (access) {
    const isRead = method === "GET" || method === "HEAD";
    try {
      if (path === "/editor") {
        await upsertUser(identity);
        await logActivity(access.project.id, identity.username, "file.opened", { kind: "file", name: access.file.name }, undefined, 10 * 60_000);
      } else if (!isRead && path.startsWith("/api/mcp/")) {
        // A write reached the editor: commit it to git ~20 s after the last one of the burst.
        scheduleSnapshot(access.file.id, access.file.tenantId, identity.username);
      }
    } catch (e) {
      console.error("gate side effect failed", e instanceof Error ? e.message : e);
    }
  }

  const token = mintEditorToken(env.tokenSecret, tenant as string, identity.username);
  return new Response(null, {
    status: 200,
    headers: { "x-edub-editor-token": token, "cache-control": "no-store" },
  });
}
