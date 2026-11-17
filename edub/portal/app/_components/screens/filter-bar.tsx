"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PLATFORM_LABEL, STATUS_LABEL } from "./labels.ts";

/** Filters live in the URL (shareable, back-button friendly); any change resets to page 1. */
export function FilterBar({ slug, current, tags }: { slug: string; current: Record<string, string>; tags: string[] }) {
  const router = useRouter();
  const [q, setQ] = useState(current.q ?? "");
  useEffect(() => setQ(current.q ?? ""), [current.q]);
  const go = (patch: Record<string, string>) => {
    const next = { ...current, ...patch };
    delete next.page;
    const sp = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    router.push(`/p/${slug}/screens${sp.size ? `?${sp}` : ""}`);
  };
  return (
    <form className="filters" onSubmit={(e) => { e.preventDefault(); go({ q: q.trim() }); }} role="search">
      <input type="search" placeholder="Rechercher (titre, description, tag, ticket)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Recherche" />
      <select value={current.platform ?? ""} onChange={(e) => go({ platform: e.target.value })} aria-label="Plateforme">
        <option value="">Plateforme</option>{Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select value={current.status ?? ""} onChange={(e) => go({ status: e.target.value })} aria-label="Statut">
        <option value="">Statut</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <select value={current.tag ?? ""} onChange={(e) => go({ tag: e.target.value })} aria-label="Tag">
        <option value="">Tag</option>{tags.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={current.sort ?? ""} onChange={(e) => go({ sort: e.target.value })} aria-label="Tri">
        <option value="">Récents</option><option value="oldest">Anciens</option><option value="title">Titre</option><option value="status">Statut</option>
      </select>
      {current.ticket ? <button type="button" className="chip chip-x" onClick={() => go({ ticket: "" })}>{current.ticket} ✕</button> : null}
    </form>
  );
}
