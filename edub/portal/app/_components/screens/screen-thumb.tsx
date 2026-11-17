"use client";
import { useEffect, useRef, useState } from "react";

/** Server-made WebP thumbnail; a placeholder while it is missing (204 / error / not yet hydrated failure). */
export function ScreenThumb({ src, type }: { src: string | null; type: string }) {
  const [ok, setOk] = useState(true);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setOk(false);
  }, [src]);
  if (!src || !ok) return <div className="shot shot-empty" aria-hidden>{type === "maquette-html" ? "</>" : type === "design" ? "◇" : "◻"}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} className="shot" src={src} alt="" loading="lazy" decoding="async" onError={() => setOk(false)} />;
}
