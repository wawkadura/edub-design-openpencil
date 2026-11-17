/**
 * Agent MCP tokens from the shell (same rules as the /admin/tokens UI) — used to provision the fleet (ED_1736).
 *
 *   sudo -u edub bash -c 'cd /home/edub/apps/edub-design/edub/portal && npx tsx scripts/mcp-token.ts <cmd> …'
 *
 *   list                                          label, prefix, scopes, last use, revoked (never the secret)
 *   projects                                      project slugs a token can be scoped to
 *   create <label> <slug:role>... --out <file>    scope = `*:editor`, `tamafit:editor`, `golfn:viewer`… ;
 *                                                 the secret goes to <file> (mode 600, refuses to overwrite), never to stdout
 *   rotate <label> <slug:role>... --out <file>    create the new token, then revoke the previous active one with that label
 *   revoke <label>
 *
 * `--out` keeps the secret out of terminals, tickets and logs: the caller moves the file into the target config.
 */
import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { chmodSync, existsSync, writeFileSync } from "node:fs";

config({ path: ".env.local", quiet: true });
const { getDb, schema } = await import("../lib/db/index.ts");
const { createToken, listTokens, revokeToken } = await import("../lib/mcp/admin.ts");

const CREATED_BY = "cli:fleet";
const [cmd, ...rest] = process.argv.slice(2);

function parseArgs(args: string[]): { positional: string[]; out?: string } {
  const positional: string[] = [];
  let out: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") out = args[++i];
    else positional.push(args[i]!);
  }
  return { positional, out };
}

function toScopes(items: string[]) {
  return items.map((s) => {
    const [project, role] = s.split(":");
    return { project, role };
  });
}

async function activeIdByLabel(label: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ id: schema.mcpTokens.id })
    .from(schema.mcpTokens)
    .where(and(eq(schema.mcpTokens.label, label), isNull(schema.mcpTokens.revokedAt)));
  return row?.id;
}

function writeSecret(out: string | undefined, secret: string): void {
  if (!out) throw new Error("--out <file> required (the secret is never printed)");
  if (existsSync(out)) throw new Error(`${out} exists: refusing to overwrite`);
  writeFileSync(out, secret, { mode: 0o600 });
  chmodSync(out, 0o600);
}

try {
  if (cmd === "list") {
    for (const t of await listTokens()) {
      console.log(
        `${t.revokedAt ? "✗" : "✓"} ${t.label.padEnd(28)} ${t.prefix}…  ${t.scopes.map((s) => `${s.project}:${s.role}`).join(",")}  last=${t.lastUsedAt?.toISOString() ?? "never"}  24h=${t.calls24h}/${t.errors24h}err`,
      );
    }
  } else if (cmd === "projects") {
    for (const p of await getDb().select({ slug: schema.projects.slug, name: schema.projects.name }).from(schema.projects)) console.log(`${p.slug}\t${p.name}`);
  } else if (cmd === "create" || cmd === "rotate") {
    const { positional, out } = parseArgs(rest);
    const [label, ...scopes] = positional;
    if (!label || scopes.length === 0) throw new Error(`usage: ${cmd} <label> <slug:role>... --out <file>`);
    const previous = cmd === "rotate" ? await activeIdByLabel(label) : undefined;
    if (previous) await revokeToken(previous); // label is unique among active tokens
    try {
      const { token, secret } = await createToken(CREATED_BY, label, toScopes(scopes));
      writeSecret(out, secret);
      console.log(`created ${token.label} (${token.prefix}…) scopes=${token.scopes.map((s) => `${s.project}:${s.role}`).join(",")} → ${out}`);
    } catch (e) {
      if (previous) await getDb().update(schema.mcpTokens).set({ revokedAt: null }).where(eq(schema.mcpTokens.id, previous)); // keep the old one usable
      throw e;
    }
  } else if (cmd === "revoke") {
    const id = await activeIdByLabel(rest[0] ?? "");
    if (!id) throw new Error("no active token with that label");
    await revokeToken(id);
    console.log(`revoked ${rest[0]}`);
  } else {
    throw new Error("usage: list | projects | create <label> <slug:role>... --out <file> | rotate … | revoke <label>");
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await (globalThis as { edubDesignPool?: { end(): Promise<void> } }).edubDesignPool?.end();
}
