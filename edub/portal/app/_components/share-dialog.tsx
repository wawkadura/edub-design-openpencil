"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Modal } from "./modal.tsx";

type M = { kind: "user" | "group"; principal: string; role: "owner" | "editor" | "viewer" };
const ROLES = { owner: "Propriétaire", editor: "Éditeur", viewer: "Lecteur" } as const;

export function ShareButton({ slug, members }: { slug: string; members: M[] }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  const base = `/api/edub/projects/${slug}/members`;
  const act = async (method: string, body: unknown) => {
    const r = await api(method, base, body);
    if (!r.ok) setErr(String(r.data.error ?? "erreur"));
    else (setErr(""), router.refresh());
  };
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>Partager</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Partager le projet">
        {() => (
          <div className="form">
            <ul className="members">
              {members.map((m) => (
                <li key={m.kind + m.principal}>
                  <span className="pill">{m.kind === "group" ? "groupe" : "user"}</span>
                  <b>{m.principal}</b>
                  <select value={m.role} onChange={(e) => act("POST", { ...m, role: e.target.value })}>
                    {Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button className="icon-btn" aria-label={`Retirer ${m.principal}`} onClick={() => act("DELETE", { kind: m.kind, principal: m.principal })}>✕</button>
                </li>
              ))}
            </ul>
            <form
              className="row add"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                await act("POST", { kind: f.get("kind"), principal: f.get("principal"), role: f.get("role") });
                e.currentTarget.reset();
              }}
            >
              <select name="kind" defaultValue="user"><option value="user">Utilisateur</option><option value="group">Groupe</option></select>
              <input name="principal" required placeholder="patrick ou tamagofit-team" />
              <select name="role" defaultValue="viewer">{Object.entries(ROLES).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <button className="btn primary">Ajouter</button>
            </form>
            {err ? <p className="err">{err}</p> : null}
            <p className="muted small">La personne doit avoir un compte Edub dans le groupe <b>design</b> (demande au supervisor).</p>
          </div>
        )}
      </Modal>
    </>
  );
}
