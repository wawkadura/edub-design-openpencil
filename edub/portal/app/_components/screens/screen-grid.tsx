"use client";
import Link from "next/link";
import { useState } from "react";
import { Lightbox } from "./lightbox.tsx";
import { PLATFORM_LABEL, STATUS_LABEL, type ScreenCardData } from "./labels.ts";
import { ScreenThumb } from "./screen-thumb.tsx";

/** One page of the gallery: thumbnails (lazy, content-visibility), lightbox, 2-card compare selection. */
export function ScreenGrid({ slug, items }: { slug: string; items: ScreenCardData[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)));
  return (
    <>
      <ul className="screen-grid">
        {items.map((s, i) => (
          <li key={s.id} className={`screen-card${picked.includes(s.id) ? " picked" : ""}`}>
            <button className="shot-btn" onClick={() => setOpen(i)} aria-label={`Agrandir ${s.title}`}>
              <ScreenThumb src={s.thumbUrl} type={s.type} />
            </button>
            <label className="pick" title="Choisir pour comparer"><input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} /></label>
            <div className="card-body">
              <Link href={s.pageUrl} className="card-title clamp">{s.title}</Link>
              <div className="chips">
                <span className="chip">{PLATFORM_LABEL[s.platform]}</span>
                <span className={`chip st-${s.status.replace(" ", "-")}`}>{STATUS_LABEL[s.status]}</span>
                {s.type === "maquette-html" ? <span className="chip">HTML</span> : null}
                {s.currentVersion > 1 ? <span className="chip">v{s.currentVersion}</span> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {picked.length === 2 ? (
        <div className="compare-bar">
          <span>2 écrans choisis</span>
          <Link className="btn primary" href={`/p/${slug}/screens/compare?a=${picked[0]}&b=${picked[1]}`}>Comparer</Link>
          <button className="btn" onClick={() => setPicked([])}>Annuler</button>
        </div>
      ) : null}
      {open !== null ? <Lightbox items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
