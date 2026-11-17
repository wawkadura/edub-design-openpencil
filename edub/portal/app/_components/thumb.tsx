"use client";
import { useState } from "react";

/** File thumbnail from the host's PNG export; a placeholder while absent (204 / error). */
export function Thumb({ fileId, label }: { fileId: string | null; label?: string }) {
  const [ok, setOk] = useState(true);
  if (!fileId || !ok) return <div className="thumb thumb-empty" aria-hidden>{label ?? "◻"}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="thumb" src={`/api/edub/files/${fileId}/thumbnail`} alt="" loading="lazy" onError={() => setOk(false)} />;
}
