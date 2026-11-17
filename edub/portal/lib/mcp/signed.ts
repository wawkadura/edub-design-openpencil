import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Short signed download links (`/mcp/dl?k=…&s=…`) for agents that prefer a URL to inline image bytes.
 * The payload names exactly one stored object; the HMAC covers it and its expiry. No session needed:
 * the signature IS the capability, and it expires (default 10 min).
 */
export type DownloadTarget =
  | { t: "screen"; p: string; s: string; n: number }
  | { t: "export"; id: string; ext: string };

type Claims = DownloadTarget & { e: number };

const mac = (secret: string, body: string) => createHmac("sha256", secret).update(`dl1.${body}`).digest("base64url");

export function signDownload(secret: string, target: DownloadTarget, ttlSecs = 600, nowSecs = Math.floor(Date.now() / 1000)): { k: string; s: string } {
  const k = Buffer.from(JSON.stringify({ ...target, e: nowSecs + ttlSecs } satisfies Claims)).toString("base64url");
  return { k, s: mac(secret, k) };
}

export function verifyDownload(secret: string, k: string, s: string, nowSecs = Math.floor(Date.now() / 1000)): DownloadTarget | null {
  const want = Buffer.from(mac(secret, k));
  const got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const c = JSON.parse(Buffer.from(k, "base64url").toString("utf8")) as Claims;
    if (typeof c.e !== "number" || c.e < nowSecs) return null;
    const { e: _e, ...target } = c;
    return target as DownloadTarget;
  } catch {
    return null;
  }
}
