import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "../db/index.ts";
import type { McpToken, Project, ProjectRole } from "../db/schema.ts";
import type { Identity } from "../identity.ts";
import { createLimiter, hashSecret, looksLikeSecret, roleOnProject, type TokenRole } from "./tokens.ts";

/** Bearer → token row (never revoked), or null. Runs on every MCP request. */
export async function authenticateToken(authorization: string | null): Promise<McpToken | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  if (!m || !looksLikeSecret(m[1]!)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.hash, hashSecret(m[1]!)), isNull(schema.mcpTokens.revokedAt)))
    .limit(1);
  return row ?? null;
}

const lastTouch = new Map<string, number>();
/** `last_used_at`, written at most once a minute per token (a busy agent must not hammer the table). */
export async function touchToken(token: McpToken): Promise<void> {
  const now = Date.now();
  if (now - (lastTouch.get(token.id) ?? 0) < 60_000) return;
  lastTouch.set(token.id, now);
  await getDb().update(schema.mcpTokens).set({ lastUsedAt: new Date(now) }).where(eq(schema.mcpTokens.id, token.id));
}

/** Light per-token limits: any call, and writes on their own tighter budget. */
export const callLimiter = createLimiter(180, 60_000);
export const writeLimiter = createLimiter(40, 60_000);

/** The pseudo-identity an agent acts as: its token label is the author in logs, commits and the gallery. */
export function agentIdentity(token: Pick<McpToken, "label">): Identity {
  return { username: `agent:${token.label}`, displayName: token.label, email: null, groups: [], impersonated: false };
}

export type TokenProjectAccess = { project: Project; role: TokenRole };

/** The project, only if the token's scopes reach it. null = "does not exist" for this token. */
export async function projectForToken(token: McpToken, slug: unknown): Promise<TokenProjectAccess | null> {
  if (typeof slug !== "string") return null;
  const role = roleOnProject(token.scopes, slug);
  if (!role) return null;
  const [project] = await getDb()
    .select()
    .from(schema.projects)
    .where(and(eq(schema.projects.slug, slug), eq(schema.projects.archived, false)))
    .limit(1);
  return project ? { project, role } : null;
}

export async function visibleProjectsForToken(token: McpToken): Promise<TokenProjectAccess[]> {
  const projects = await getDb().select().from(schema.projects).where(eq(schema.projects.archived, false));
  const out: TokenProjectAccess[] = [];
  for (const project of projects) {
    const role = roleOnProject(token.scopes, project.slug);
    if (role) out.push({ project, role });
  }
  return out.sort((a, b) => a.project.name.localeCompare(b.project.name, "fr"));
}

export const asProjectRole = (r: TokenRole): ProjectRole => r;

export async function journal(tokenId: string, tool: string, project: string | null, ok: boolean, error: string | null, ms: number) {
  try {
    await getDb().insert(schema.mcpCalls).values({ tokenId, tool, project, ok, error: error?.slice(0, 300) ?? null, ms });
  } catch (e) {
    console.error("mcp journal failed", e instanceof Error ? e.message : e);
  }
}
