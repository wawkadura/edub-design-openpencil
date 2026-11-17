import { createHash, randomBytes } from "node:crypto";
import type { ProjectRole, TokenScope } from "../db/schema.ts";

/**
 * Agent tokens: pure logic (no I/O, unit-tested in tokens.test.ts).
 * A token carries a list of `{project, role}` scopes; `project` is a slug or `*` (every project,
 * including future ones). A token is never an owner: it caps at `editor`.
 */
export const TOKEN_PREFIX = "edd_";
export const LABEL_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/;
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
export const TOKEN_ROLES = ["viewer", "editor"] as const;
export type TokenRole = (typeof TOKEN_ROLES)[number];

export function generateSecret(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/** First characters shown in the admin list to recognise a token (never enough to use it). */
export function secretPrefix(secret: string): string {
  return secret.slice(0, TOKEN_PREFIX.length + 4);
}

export function looksLikeSecret(s: string): boolean {
  return s.startsWith(TOKEN_PREFIX) && s.length >= TOKEN_PREFIX.length + 40 && s.length <= 128 && /^[A-Za-z0-9_-]+$/.test(s);
}

/** Validate the admin's scope list; null = invalid. Duplicates of a project keep the strongest role. */
export function parseScopes(raw: unknown): TokenScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 100) return null;
  const byProject = new Map<string, TokenScope["role"]>();
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const { project, role } = item as Record<string, unknown>;
    if (typeof project !== "string" || !(project === "*" || SLUG_RE.test(project))) return null;
    if (role !== "viewer" && role !== "editor") return null;
    const prev = byProject.get(project);
    if (!prev || (prev === "viewer" && role === "editor")) byProject.set(project, role);
  }
  return [...byProject].map(([project, role]) => ({ project, role }));
}

const RANK: Record<TokenRole, number> = { viewer: 1, editor: 2 };

/** Role the token has on a project (strongest matching scope), or null = the project does not exist for it. */
export function roleOnProject(scopes: readonly TokenScope[], slug: string): TokenRole | null {
  let best: TokenRole | null = null;
  for (const s of scopes) {
    if (s.project !== "*" && s.project !== slug) continue;
    if (!best || RANK[s.role] > RANK[best]) best = s.role;
  }
  return best;
}

export const canWriteWith = (role: ProjectRole | TokenRole): boolean => role === "editor" || role === "owner";

/** Fixed-window-free sliding limiter: at most `limit` hits per `windowMs` for each key. */
export function createLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    /** true = allowed (and counted). */
    take(key: string): boolean {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
  };
}
