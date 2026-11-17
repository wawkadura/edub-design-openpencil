"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Modal } from "../../_components/modal.tsx";

type Scope = { project: string; role: "viewer" | "editor" };
export type TokenRow = {
  id: string; label: string; prefix: string; scopes: Scope[]; createdBy: string; createdAt: string;
  lastUsedAt: string | null; revokedAt: string | null; calls24h: number; errors24h: number;
};
type Project = { slug: string; name: string; emoji: string | null };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }) : "jamais");

export function TokenAdmin({ tokens, projects }: { tokens: TokenRow[]; projects: Project[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [rows, setRows] = useState<Record<string, "" | "viewer" | "editor">>({});
  const [all, setAll] = useState<"" | "viewer" | "editor">("");
  const [copied, setCopied] = useState(false);

  const revoke = async (t: TokenRow) => {
    if (!confirm(`Révoquer « ${t.label} » ? L'agent recevra 401 immédiatement.`)) return;
    await api("DELETE", `/api/edub/admin/tokens/${t.id}`);
    router.refresh();
  };

  return (
    <>
      <p><button className="btn primary" onClick={() => { setOpen(true); setErr(""); setRows({}); setAll(""); }}>+ Nouveau jeton</button></p>
      {secret ? (
        <div className="secret-box" role="alert">
          <b>Jeton « {secret.label} » créé.</b> Copie-le maintenant : il ne sera plus jamais affiché.
          <pre>{secret.value}</pre>
          <button className="btn small-btn" onClick={async () => { await navigator.clipboard.writeText(secret.value); setCopied(true); }}>{copied ? "Copié ✓" : "Copier"}</button>{" "}
          <button className="btn small-btn" onClick={() => { setSecret(null); setCopied(false); }}>J&apos;ai copié le jeton</button>
        </div>
      ) : null}
      {tokens.length === 0 ? (
        <p className="muted">Aucun jeton. Crée-en un par agent ou par équipe (TamaFit, GolfN…).</p>
      ) : (
        <table className="tokens">
          <thead><tr><th>Label</th><th>Portées</th><th>Créé</th><th>Dernière utilisation</th><th>24 h</th><th /></tr></thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.id} className={t.revokedAt ? "revoked" : ""}>
                <td><b>{t.label}</b><div className="muted small"><code>{t.prefix}…</code></div></td>
                <td>{t.scopes.map((s) => <span key={s.project} className="chip">{s.project === "*" ? "tous les projets" : s.project} · {s.role === "editor" ? "éditeur" : "lecteur"}</span>)}</td>
                <td>{when(t.createdAt)}<div className="muted small">par {t.createdBy}</div></td>
                <td>{when(t.lastUsedAt)}</td>
                <td>{t.calls24h} appel{t.calls24h > 1 ? "s" : ""}{t.errors24h ? <span className="err"> · {t.errors24h} err.</span> : null}</td>
                <td>{t.revokedAt ? <span className="muted small">révoqué {when(t.revokedAt)}</span> : <button className="btn small-btn" onClick={() => revoke(t)}>Révoquer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau jeton MCP">
        {(dismiss) => (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const scopes: Scope[] = all ? [{ project: "*", role: all }] : Object.entries(rows).filter(([, r]) => r).map(([project, role]) => ({ project, role: role as "viewer" | "editor" }));
              const r = await api("POST", "/api/edub/admin/tokens", { label: f.get("label"), scopes });
              if (!r.ok) return setErr(String(r.data.error ?? "erreur"));
              setSecret({ label: String(f.get("label")), value: String(r.data.secret) });
              dismiss();
              router.refresh();
            }}
          >
            <label>Label (nom de l&apos;agent)<input name="label" required maxLength={40} placeholder="tamafit-product-manager" pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{0,39}" /></label>
            <fieldset>
              <legend>Projets accessibles</legend>
              <label className="inline">Tous les projets (y compris futurs)
                <select value={all} onChange={(e) => setAll(e.target.value as "" | "viewer" | "editor")}>
                  <option value="">non</option><option value="viewer">lecteur</option><option value="editor">éditeur</option>
                </select>
              </label>
              {all ? null : projects.map((p) => (
                <label key={p.slug} className="inline">{p.emoji ?? "📁"} {p.name}
                  <select value={rows[p.slug] ?? ""} onChange={(e) => setRows({ ...rows, [p.slug]: e.target.value as "" | "viewer" | "editor" })}>
                    <option value="">aucun accès</option><option value="viewer">lecteur</option><option value="editor">éditeur</option>
                  </select>
                </label>
              ))}
            </fieldset>
            {err ? <p className="err">{err}</p> : null}
            <button className="btn primary">Créer le jeton</button>
          </form>
        )}
      </Modal>
    </>
  );
}
