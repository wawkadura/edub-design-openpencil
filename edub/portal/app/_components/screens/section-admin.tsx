"use client";
import { useRouter } from "next/navigation";
import { api } from "../modal.tsx";

/** Add / rename / delete / reorder sections (editors and owners). */
export function SectionAdmin({ slug, section }: { slug: string; section?: { id: string; name: string; isRoot: boolean } }) {
  const router = useRouter();
  const base = `/api/edub/projects/${slug}/sections`;
  const run = async (p: Promise<{ ok: boolean; data: Record<string, unknown> }>) => {
    const r = await p;
    if (!r.ok) alert(String(r.data.error ?? "erreur"));
    else router.refresh();
  };
  if (!section) {
    return <button className="btn small-btn" onClick={() => { const n = prompt("Nom de la section (fonctionnalité / parcours)"); if (n) void run(api("POST", base, { name: n })); }}>+ Section</button>;
  }
  return (
    <span className="sec-actions">
      <button className="icon-btn" title="Monter" onClick={() => void run(api("PATCH", `${base}/${section.id}`, { move: "up" }))}>↑</button>
      <button className="icon-btn" title="Descendre" onClick={() => void run(api("PATCH", `${base}/${section.id}`, { move: "down" }))}>↓</button>
      {section.isRoot ? <button className="icon-btn" title="Sous-section" onClick={() => { const n = prompt("Nom de la sous-section"); if (n) void run(api("POST", base, { name: n, parentId: section.id })); }}>＋</button> : null}
      <button className="icon-btn" title="Renommer" onClick={() => { const n = prompt("Nouveau nom", section.name); if (n && n !== section.name) void run(api("PATCH", `${base}/${section.id}`, { name: n })); }}>✎</button>
      <button className="icon-btn danger" title="Supprimer (les écrans sont conservés)" onClick={() => { if (confirm(`Supprimer la section « ${section.name} » ? Ses écrans sont conservés, sans section.`)) void run(api("DELETE", `${base}/${section.id}`)); }}>🗑</button>
    </span>
  );
}
