import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../db/index.ts";
import type { McpCall, McpToken } from "../db/schema.ts";
import { HttpError } from "../projects.ts";
import { generateSecret, hashSecret, LABEL_RE, parseScopes, secretPrefix } from "./tokens.ts";

/** Admin operations on agent tokens (Authelia `admin` only — checked by the callers). */
export type TokenView = Omit<McpToken, "hash"> & { calls24h: number; errors24h: number };

export async function listTokens(): Promise<TokenView[]> {
  const db = getDb();
  const rows = await db.select().from(schema.mcpTokens).orderBy(desc(schema.mcpTokens.createdAt));
  const stats = await db.execute(
    sql`select token_id, count(*)::int as n, count(*) filter (where not ok)::int as bad from mcp_call where created_at > now() - interval '24 hours' group by token_id`,
  );
  const byId = new Map((stats.rows as { token_id: string; n: number; bad: number }[]).map((r) => [r.token_id, r]));
  return rows.map(({ hash: _hash, ...t }) => ({ ...t, calls24h: byId.get(t.id)?.n ?? 0, errors24h: byId.get(t.id)?.bad ?? 0 }));
}

/** Creates the token and returns its secret — the only time it exists in clear. */
export async function createToken(createdBy: string, labelRaw: unknown, scopesRaw: unknown): Promise<{ token: Omit<McpToken, "hash">; secret: string }> {
  const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
  if (!LABEL_RE.test(label)) throw new HttpError(400, "label invalide (lettres, chiffres, . _ -, 40 max)");
  const scopes = parseScopes(scopesRaw);
  if (!scopes) throw new HttpError(400, "portées invalides (au moins un projet, rôle viewer ou editor)");
  const db = getDb();
  const [dup] = await db.select({ id: schema.mcpTokens.id }).from(schema.mcpTokens).where(and(eq(schema.mcpTokens.label, label), isNull(schema.mcpTokens.revokedAt)));
  if (dup) throw new HttpError(409, "un jeton actif porte déjà ce label");
  const known = new Set((await db.select({ slug: schema.projects.slug }).from(schema.projects)).map((p) => p.slug));
  const unknown = scopes.find((s) => s.project !== "*" && !known.has(s.project));
  if (unknown) throw new HttpError(400, `projet inconnu : ${unknown.project}`);
  const secret = generateSecret();
  const [row] = await db.insert(schema.mcpTokens).values({ label, prefix: secretPrefix(secret), hash: hashSecret(secret), scopes, createdBy }).returning();
  if (!row) throw new HttpError(500, "création impossible");
  const { hash: _hash, ...token } = row;
  return { token, secret };
}

export async function revokeToken(id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(404, "not_found");
  const res = await getDb()
    .update(schema.mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.mcpTokens.id, id), isNull(schema.mcpTokens.revokedAt)))
    .returning({ id: schema.mcpTokens.id });
  if (res.length === 0) throw new HttpError(404, "not_found");
}

export async function recentCalls(limit = 40): Promise<(McpCall & { label: string })[]> {
  const rows = await getDb()
    .select({ call: schema.mcpCalls, label: schema.mcpTokens.label })
    .from(schema.mcpCalls)
    .innerJoin(schema.mcpTokens, eq(schema.mcpTokens.id, schema.mcpCalls.tokenId))
    .orderBy(desc(schema.mcpCalls.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r.call, label: r.label }));
}
