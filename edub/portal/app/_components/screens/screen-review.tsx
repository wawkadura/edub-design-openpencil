"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "../modal.tsx";
import { MockupFrame } from "./phone-frame.tsx";

export type CommentView = { id: string; author: string; html: string; pinX: number | null; pinY: number | null; versionN: number | null; createdAt: string; mine: boolean };

/** Viewer of one screen (image or sandboxed mockup) with optional pinned comments, then the thread. */
export function ScreenReview({ slug, screenId, type, fileUrl, title, version, comments, members, canDelete }: {
  slug: string; screenId: string; type: string; fileUrl: string | null; title: string; version: number; comments: CommentView[]; members: string[]; canDelete: boolean;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState(true);
  const [pinMode, setPinMode] = useState(false);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const base = `/api/edub/projects/${slug}/screens/${screenId}/comments`;
  const pinned = comments.filter((c) => c.pinX !== null && c.versionN === version);

  const submit = async () => {
    if (!body.trim()) return;
    const r = await api("POST", base, { body, versionN: version, ...(pin ? { pinX: pin.x, pinY: pin.y } : {}) });
    if (!r.ok) return setErr(String(r.data.error ?? "erreur"));
    setBody(""); setPin(null); setPinMode(false); setErr("");
    router.refresh();
  };
  return (
    <>
      <div className="viewer">
        <div className="viewer-bar">
          {type === "maquette-html" ? <button className="btn" onClick={() => setPhone(!phone)}>{phone ? "Pleine largeur" : "Cadre téléphone 390×844"}</button> : null}
          {type === "capture" ? <button className={`btn${pinMode ? " primary" : ""}`} onClick={() => setPinMode(!pinMode)}>{pinMode ? "Clique sur l'image…" : "📍 Épingler un commentaire"}</button> : null}
          {fileUrl ? <a className="btn" href={`${fileUrl}${fileUrl.includes("?") ? "&" : "?"}download=1`}>Télécharger</a> : null}
        </div>
        {fileUrl && type === "maquette-html" ? (
          <MockupFrame src={fileUrl} phone={phone} title={title} />
        ) : fileUrl ? (
          <div
            className={`pin-surface${pinMode ? " pinning" : ""}`}
            onClick={(e) => {
              if (!pinMode) return;
              const r = e.currentTarget.getBoundingClientRect();
              setPin({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) });
              setPinMode(false);
              area.current?.focus();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="viewer-img" src={fileUrl} alt={title} />
            {pinned.map((c, i) => <span key={c.id} className="pin" style={{ left: `${c.pinX! * 100}%`, top: `${c.pinY! * 100}%` }} title={c.author}>{i + 1}</span>)}
            {pin ? <span className="pin new" style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}>+</span> : null}
          </div>
        ) : <p className="muted">Écran lié à un fichier .op : pas d&apos;aperçu ici.</p>}
      </div>

      <section className="comments">
        <h2>Commentaires ({comments.length})</h2>
        <ul className="clist">
          {comments.map((c) => (
            <li key={c.id}>
              <div className="small"><b>{c.author}</b> <span className="muted">{new Date(c.createdAt).toLocaleString("fr-FR")}{c.versionN ? ` · v${c.versionN}` : ""}{c.pinX !== null ? " · 📍" : ""}</span>
                {c.mine || canDelete ? <button className="link danger" onClick={async () => { await api("DELETE", `${base}/${c.id}`); router.refresh(); }}>supprimer</button> : null}</div>
              <div className="md" dangerouslySetInnerHTML={{ __html: c.html }} />
            </li>
          ))}
          {comments.length === 0 ? <li className="muted small">Pas encore de commentaire.</li> : null}
        </ul>
        <div className="form">
          <label>Nouveau commentaire (markdown, @membre{pin ? ", épinglé sur l'image" : ""})
            <textarea ref={area} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Ton retour…" />
          </label>
          {members.length ? <p className="muted small">Mentionnables : {members.map((m) => `@${m}`).join(" ")}</p> : null}
          {err ? <p className="err">{err}</p> : null}
          <div><button className="btn primary" disabled={!body.trim()} onClick={() => void submit()}>Commenter</button> {pin ? <button className="btn" onClick={() => setPin(null)}>Retirer l&apos;épingle</button> : null}</div>
        </div>
      </section>
    </>
  );
}
