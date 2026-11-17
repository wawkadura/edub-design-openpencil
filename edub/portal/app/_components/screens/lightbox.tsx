"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MockupFrame } from "./phone-frame.tsx";
import { PLATFORM_LABEL, STATUS_LABEL, type ScreenCardData } from "./labels.ts";

/**
 * Full-screen viewer: ←/→ (or swipe) to navigate, Esc / ✕ / the back gesture to close
 * (opening pushes a history entry, popstate closes).
 */
export function Lightbox({ items, index, onIndex, onClose }: { items: ScreenCardData[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const [phone, setPhone] = useState(true);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const idx = useRef(index);
  idx.current = index;
  const item = items[index]!;

  useEffect(() => {
    history.pushState({ edubLightbox: true }, "");
    const onPop = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") history.back();
      else if (e.key === "ArrowRight" && idx.current < items.length - 1) onIndex(idx.current + 1);
      else if (e.key === "ArrowLeft" && idx.current > 0) onIndex(idx.current - 1);
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (d: number) => {
    const n = index + d;
    if (n >= 0 && n < items.length) onIndex(n);
  };
  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      onTouchStart={(e) => (touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t) return;
        const dx = e.changedTouches[0]!.clientX - t.x;
        const dy = e.changedTouches[0]!.clientY - t.y;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      <header className="lb-head">
        <div className="lb-title">
          <b>{item.title}</b>
          <span className="muted small"> {PLATFORM_LABEL[item.platform]} · {STATUS_LABEL[item.status]} · v{item.currentVersion} · {index + 1}/{items.length}</span>
        </div>
        <div className="row-actions">
          {item.type === "maquette-html" ? <button className="btn" onClick={() => setPhone(!phone)}>{phone ? "Pleine largeur" : "Cadre téléphone"}</button> : null}
          <Link className="btn" href={item.pageUrl}>Détails</Link>
          <button className="icon-btn" onClick={() => history.back()} aria-label="Fermer">✕</button>
        </div>
      </header>
      <div className="lb-stage" onClick={(e) => e.target === e.currentTarget && history.back()}>
        <button className="lb-nav prev" disabled={index === 0} onClick={() => go(-1)} aria-label="Précédent">‹</button>
        {item.type === "maquette-html" && item.fileUrl ? (
          <MockupFrame key={item.id} src={item.fileUrl} phone={phone} title={item.title} />
        ) : item.fileUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={item.id} className="lb-img" src={item.fileUrl} alt={item.title} />
        ) : (
          <p className="muted">Pas d&apos;aperçu (écran lié à un fichier .op).</p>
        )}
        <button className="lb-nav next" disabled={index === items.length - 1} onClick={() => go(1)} aria-label="Suivant">›</button>
      </div>
    </div>
  );
}
