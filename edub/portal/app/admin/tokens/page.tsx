import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/lib/db/index.ts";
import { isAdmin } from "@/lib/identity.ts";
import { listTokens, recentCalls } from "@/lib/mcp/admin.ts";
import { pageAuth } from "@/lib/page-auth.ts";
import { TokenAdmin } from "./token-admin.tsx";

export const dynamic = "force-dynamic";

export default async function TokensPage() {
  const auth = await pageAuth();
  if ("message" in auth) return <main className="shell"><p className="muted">{auth.message}</p></main>;
  if (!isAdmin(auth.identity)) notFound();
  const [tokens, calls, projects] = await Promise.all([
    listTokens(),
    recentCalls(30),
    getDb().select({ slug: schema.projects.slug, name: schema.projects.name, emoji: schema.projects.emoji }).from(schema.projects).orderBy(schema.projects.name),
  ]);
  return (
    <main className="shell">
      <nav className="crumbs"><Link href="/">Mes projets</Link> / Jetons MCP</nav>
      <header className="top">
        <div>
          <h1>Jetons MCP des agents</h1>
          <p className="muted">
            Endpoint <code>https://design.edub.fr/mcp</code>. Chaque jeton ne voit que les projets de ses portées, avec un rôle plafonné à éditeur.
          </p>
        </div>
      </header>
      <TokenAdmin
        projects={projects}
        tokens={tokens.map((t) => ({
          id: t.id,
          label: t.label,
          prefix: t.prefix,
          scopes: t.scopes,
          createdBy: t.createdBy,
          createdAt: t.createdAt.toISOString(),
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          revokedAt: t.revokedAt?.toISOString() ?? null,
          calls24h: t.calls24h,
          errors24h: t.errors24h,
        }))}
      />
      <h2>Derniers appels</h2>
      {calls.length === 0 ? (
        <p className="muted">Aucun appel pour l&apos;instant.</p>
      ) : (
        <table className="tokens">
          <thead><tr><th>Quand</th><th>Agent</th><th>Outil</th><th>Projet</th><th>Résultat</th><th>ms</th></tr></thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td>{c.createdAt.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "medium" })}</td>
                <td>{c.label}</td>
                <td><code>{c.tool}</code></td>
                <td>{c.project ?? "—"}</td>
                <td>{c.ok ? "ok" : <span className="err">{c.error ?? "erreur"}</span>}</td>
                <td>{c.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
