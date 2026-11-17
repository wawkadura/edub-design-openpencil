import { createHash } from "node:crypto";
import { parseGroups, type Identity } from "./identity.ts";

/**
 * Resolve the Authelia session behind a Cookie header by asking Authelia's own
 * auth-request endpoint (loopback). Used by the editor gate: nginx runs the gate
 * INSTEAD of the server-level Authelia check on editor API routes (one auth_request
 * per location), so the gate re-checks Authelia itself. Short positive cache so an
 * editing session does not hit Authelia on every keystroke; removal from the
 * `design` group is still honoured within CACHE_TTL_MS.
 */
const CACHE_TTL_MS = 15_000;
const MAX_CACHE = 1000;
const cache = new Map<string, { identity: Identity | null; until: number }>();

export async function identityFromAutheliaCookie(
  autheliaUrl: string,
  cookieHeader: string | null,
  originalUrl: string,
  method: string,
): Promise<Identity | null> {
  if (!cookieHeader || !cookieHeader.includes("authelia_session=")) return null;
  const key = createHash("sha256").update(cookieHeader).digest("hex");
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return hit.identity;

  const res = await fetch(`${autheliaUrl}/api/authz/auth-request`, {
    method: "GET",
    headers: {
      cookie: cookieHeader,
      "x-original-url": originalUrl,
      "x-original-method": method,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  let identity: Identity | null = null;
  if (res.status === 200) {
    const username = res.headers.get("remote-user")?.trim();
    if (username) {
      identity = {
        username,
        displayName: res.headers.get("remote-name"),
        email: res.headers.get("remote-email"),
        groups: parseGroups(res.headers.get("remote-groups")),
        impersonated: false,
      };
    }
  } else if (res.status !== 401 && res.status !== 403) {
    // Authelia trouble: fail closed, but do not cache a negative.
    throw new Error(`authelia answered ${res.status}`);
  }
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(key, { identity, until: now + CACHE_TTL_MS });
  return identity;
}
