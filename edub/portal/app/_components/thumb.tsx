"use client";
import { useEffect, useRef, useState } from "react";

/**
 * File thumbnail from the host's PNG export; a placeholder while absent (204 / error).
 * The image may fail BEFORE React hydrates (server-rendered <img>), when onError never fires:
 * the effect re-checks `complete && naturalWidth === 0` once mounted.
 */
export function Thumb({ fileId, label }: { fileId: string | null; label?: string }) {
  const [ok, setOk] = useState(true);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setOk(false);
  }, [fileId]);
  if (!fileId || !ok) return <div className="thumb thumb-empty" aria-hidden>{label ?? "◻"}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} className="thumb" src={`/api/edub/files/${fileId}/thumbnail`} alt="" loading="lazy" onError={() => setOk(false)} />;
}
