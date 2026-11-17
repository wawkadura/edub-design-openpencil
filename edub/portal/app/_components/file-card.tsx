"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Modal } from "./modal.tsx";
import { Thumb } from "./thumb.tsx";

type Version = { sha: string; author: string; date: string; message: string };
type FolderOpt = { id: string; name: string };
export type FileView = { id: string; name: string; tenantId: string; folderId: string | null; screenCount: number; updatedAt: string; trashed: boolean };

const fmt = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });

export function FileCard({ file, canWrite, folders }: { file: FileView; canWrite: boolean; folders: FolderOpt[] }) {
  const router = useRouter();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [menu, setMenu] = useState(false);
  const [err, setErr] = useState("");
  const done = async (p: Promise<{ ok: boolean; data: Record<string, unknown> }>) => {
    const r = await p;
    if (!r.ok) setErr(String(r.data.error ?? "erreur"));
    else (setErr(""), setMenu(false), router.refresh());
  };
  const url = `/api/edub/files/${file.id}`;
  return (
    <li className="file-card">
      {file.trashed ? <Thumb fileId={null} label="🗑" /> : <a href={`/editor?tenant=${file.tenantId}`}><Thumb fileId={file.id} /></a>}
      <div className="file-meta">
        <div className="file-name" title={file.name}>{file.name}</div>
        <div className="muted small">{file.screenCount} écran{file.screenCount > 1 ? "s" : ""} · {fmt(file.updatedAt)}</div>
      </div>
      <div className="file-actions">
        {file.trashed ? (
          canWrite ? <button className="btn" onClick={() => done(api("PATCH", url, { restore: true }))}>Restaurer</button> : null
        ) : (
          <>
            <a className="btn primary" href={`/editor?tenant=${file.tenantId}`}>Ouvrir</a>
            <button className="icon-btn" aria-label="Plus d'actions" onClick={() => setMenu((v) => !v)}>⋯</button>
          </>
        )}
      </div>
      {menu ? (
        <div className="menu">
          <button onClick={async () => { const r = await api("GET", `${url}/versions`); setVersions((r.data.versions as Version[]) ?? []); setMenu(false); }}>Historique</button>
          {canWrite ? (
            <>
              <button onClick={() => { const n = prompt("Nouveau nom", file.name); if (n) void done(api("PATCH", url, { name: n })); }}>Renommer</button>
              <button onClick={() => done(api("POST", `${url}/duplicate`))}>Dupliquer</button>
              {folders.length ? (
                <select defaultValue="" onChange={(e) => done(api("PATCH", url, { folderId: e.target.value === "root" ? null : e.target.value }))} aria-label="Déplacer">
                  <option value="" disabled>Déplacer vers…</option>
                  <option value="root">Racine</option>
                  {folders.filter((f) => f.id !== file.folderId).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              ) : null}
              <button className="danger" onClick={() => done(api("DELETE", url))}>Mettre à la corbeille</button>
            </>
          ) : null}
          {err ? <p className="err">{err}</p> : null}
        </div>
      ) : null}
      <Modal open={versions !== null} onClose={() => setVersions(null)} title={`Historique — ${file.name}`}>
        {(dismiss) => (
          <div className="form">
            {canWrite ? (
              <button className="btn" onClick={async () => { const r = await api("POST", `${url}/versions`); if (r.ok) setVersions(((await api("GET", `${url}/versions`)).data.versions as Version[]) ?? []); else setErr(String(r.data.error ?? "erreur")); }}>
                Enregistrer une version maintenant
              </button>
            ) : null}
            {versions?.length === 0 ? <p className="muted">Aucune version enregistrée.</p> : null}
            <ul className="versions">
              {versions?.map((v, i) => (
                <li key={v.sha}>
                  <div><b>{v.author}</b> <span className="muted small">{fmt(v.date)}{i === 0 ? " · actuelle" : ""}</span></div>
                  <div className="muted small">{v.message}</div>
                  {canWrite && i > 0 ? (
                    <button className="btn" onClick={async () => { if (!confirm("Restaurer cette version ? L'état actuel est d'abord enregistré.")) return; const r = await api("POST", `${url}/restore`, { sha: v.sha }); if (r.ok) { dismiss(); router.refresh(); } else setErr(String(r.data.error ?? "erreur")); }}>Restaurer</button>
                  ) : null}
                </li>
              ))}
            </ul>
            {err ? <p className="err">{err}</p> : null}
          </div>
        )}
      </Modal>
    </li>
  );
}
