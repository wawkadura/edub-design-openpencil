"use client";
import { useRouter } from "next/navigation";
import { api } from "./modal.tsx";

export function FolderActions({ slug, id, name }: { slug: string; id: string; name: string }) {
  const router = useRouter();
  const base = `/api/edub/projects/${slug}/folders`;
  return (
    <span className="folder-actions">
      <button className="icon-btn" aria-label={`Renommer ${name}`} onClick={async () => { const n = prompt("Nouveau nom", name); if (n) { await api("PATCH", base, { id, name: n }); router.refresh(); } }}>✎</button>
      <button className="icon-btn" aria-label={`Supprimer ${name}`} onClick={async () => { if (confirm(`Supprimer « ${name} » ? Ses fichiers vont à la corbeille.`)) { await api("DELETE", base, { id }); router.refresh(); } }}>🗑</button>
    </span>
  );
}
