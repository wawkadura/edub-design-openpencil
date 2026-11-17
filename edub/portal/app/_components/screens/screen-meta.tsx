"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "../modal.tsx";
import { PLATFORM_LABEL, STATUS_LABEL } from "./labels.ts";

export type SectionOption = { id: string; name: string; parentId: string | null };
type Initial = { title: string; sectionId: string | null; platform: string; status: string; tags: string[]; description: string; links: { type: string; ref?: string; url?: string }[] };

/** Edit form of a screen's metadata (editors / owners). */
export function ScreenMeta({ slug, screenId, initial, sections }: { slug: string; screenId: string; initial: Initial; sections: SectionOption[] }) {
  const router = useRouter();
  const [f, setF] = useState({ ...initial, tags: initial.tags.join(", "), links: initial.links.map((l) => l.ref ?? l.url ?? "").join("\n") });
  const [msg, setMsg] = useState("");
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const r = await api("PATCH", `/api/edub/projects/${slug}/screens/${screenId}`, {
      title: f.title, sectionId: f.sectionId || null, platform: f.platform, status: f.status, tags: f.tags, description: f.description,
      links: f.links.split(/\s*\n\s*/).filter(Boolean),
    });
    setMsg(r.ok ? "Enregistré" : String(r.data.error ?? "erreur"));
    if (r.ok) router.refresh();
  };
  return (
    <div className="form meta-form">
      <label>Titre<input value={f.title} onChange={(e) => set("title", e.target.value)} /></label>
      <div className="row">
        <label>Section<select value={f.sectionId ?? ""} onChange={(e) => set("sectionId", e.target.value)}><option value="">— aucune —</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.parentId ? "  ↳ " : ""}{s.name}</option>)}</select></label>
        <label>Plateforme<select value={f.platform} onChange={(e) => set("platform", e.target.value)}>{Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label>Statut<select value={f.status} onChange={(e) => set("status", e.target.value)}>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      </div>
      <label>Tags (séparés par des virgules)<input value={f.tags} onChange={(e) => set("tags", e.target.value)} /></label>
      <label>Description (markdown)<textarea rows={4} value={f.description} onChange={(e) => set("description", e.target.value)} /></label>
      <label>Liens — un par ligne : <code>ED_1234</code>, URL de PR ou autre URL<textarea rows={3} value={f.links} onChange={(e) => set("links", e.target.value)} /></label>
      <div className="row-actions"><button className="btn primary" onClick={() => void save()}>Enregistrer</button><span className={msg === "Enregistré" ? "muted small" : "err"}>{msg}</span>
        <button className="btn danger" onClick={async () => { if (!confirm("Supprimer cet écran et toutes ses versions ?")) return; const r = await api("DELETE", `/api/edub/projects/${slug}/screens/${screenId}`); if (r.ok) location.href = `/p/${slug}/screens`; }}>Supprimer</button></div>
    </div>
  );
}
