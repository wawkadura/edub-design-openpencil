import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Per-file editor credential. nginx asks the portal gate before every editor API
 * call; the gate checks the user's rights on the file and answers with one of these,
 * which nginx injects as `Authorization: Bearer` towards the Rust editor. The editor
 * introspects it back at the portal (`POST /api/v1/tokens/introspect`) and serves the
 * tenant named by `t` — so the editor's tenant key is always the FILE, never a user.
 *
 * Format: `edt1.<base64url(json {t,u,e})>.<base64url(hmac-sha256)>`.
 */
export type EditorTokenClaims = { t: string; u: string; e: number };

const PREFIX = "edt1";
export const TENANT_RE = /^f_[0-9a-f]{32}$/;
export const DEFAULT_TOKEN_TTL_SECS = 600;

function sign(secret: string, body: string): string {
  return createHmac("sha256", secret).update(`${PREFIX}.${body}`).digest("base64url");
}

export function mintEditorToken(
  secret: string,
  tenant: string,
  username: string,
  nowSecs = Math.floor(Date.now() / 1000),
  ttlSecs = DEFAULT_TOKEN_TTL_SECS,
): string {
  if (!TENANT_RE.test(tenant)) throw new Error("invalid tenant id");
  const claims: EditorTokenClaims = { t: tenant, u: username, e: nowSecs + ttlSecs };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${PREFIX}.${body}.${sign(secret, body)}`;
}

export function verifyEditorToken(
  secret: string,
  token: string,
  nowSecs = Math.floor(Date.now() / 1000),
): EditorTokenClaims | null {
  if (token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, body, sig] = parts as [string, string, string];
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const { t, u, e } = claims as Record<string, unknown>;
  if (typeof t !== "string" || !TENANT_RE.test(t)) return null;
  if (typeof u !== "string" || u.length === 0) return null;
  if (typeof e !== "number" || e <= nowSecs) return null;
  return { t, u, e };
}

/** Constant-time comparison for shared secrets. */
export function secretEquals(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
