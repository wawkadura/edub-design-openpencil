import { TENANT_RE } from "./editor-token.ts";
import type { ProjectRole } from "./db/schema.ts";

/**
 * Pure decision for one editor API call (nginx auth_request → /internal/edub-editor-gate).
 * Everything that touches the network or the DB is resolved by the route; this function
 * only decides, so every rule is unit-tested in gate.test.ts.
 */

/** Editor routes no Edub user may reach (sharing and device login stay in the portal). */
export const BLOCKED_PREFIXES = ["/api/share/", "/api/auth/", "/api/file/"] as const;

const READ_METHODS = new Set(["GET", "HEAD"]);

export type GateRequest = { path: string; tenant: string | null };

export function parseOriginalUri(uri: string): GateRequest {
  const q = uri.indexOf("?");
  const path = q === -1 ? uri : uri.slice(0, q);
  const query = q === -1 ? "" : uri.slice(q + 1);
  let tenant: string | null = null;
  for (const pair of query.split("&")) {
    const eq = pair.indexOf("=");
    if (eq > 0 && pair.slice(0, eq) === "tenant") {
      // Same rule as the editor (op_editor_core::share_routes::tenant_from_query):
      // first `tenant=` wins, no percent-decoding.
      tenant = pair.slice(eq + 1) || null;
      break;
    }
  }
  return { path, tenant };
}

export type GateDecision =
  | { allow: true }
  | { allow: false; status: 401 | 403; reason: string };

export function decide(input: {
  method: string;
  path: string;
  tenant: string | null;
  origin: string | null;
  publicOrigin: string;
  /** Role of the caller on the file's project; null = no access. Admin = "owner". */
  role: ProjectRole | null;
}): GateDecision {
  const method = input.method.toUpperCase();
  if (!input.path.startsWith("/api/") || input.path.includes("..")) {
    return { allow: false, status: 403, reason: "not-an-editor-api-route" };
  }
  if (BLOCKED_PREFIXES.some((p) => input.path.startsWith(p))) {
    return { allow: false, status: 403, reason: "route-disabled-on-edub" };
  }
  if (!input.tenant || !TENANT_RE.test(input.tenant)) {
    return { allow: false, status: 403, reason: "missing-or-invalid-tenant" };
  }
  const isRead = READ_METHODS.has(method);
  // CSRF: a write must come from our own page. Bearer injection happens in nginx,
  // so the editor's own cookie-origin check never runs — this is the boundary.
  if (!isRead && input.origin !== input.publicOrigin) {
    return { allow: false, status: 403, reason: "cross-origin-write-forbidden" };
  }
  if (input.role === null) {
    return { allow: false, status: 403, reason: "no-access-to-file" };
  }
  if (input.role === "viewer" && !isRead) {
    return { allow: false, status: 403, reason: "read-only-access" };
  }
  return { allow: true };
}
