"use client";
import { useState } from "react";

/** Copies the share link of a screen (members of the project only can open it). */
export function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="btn" onClick={async () => { await navigator.clipboard?.writeText(url).catch(() => {}); setDone(true); setTimeout(() => setDone(false), 1500); }}>
      {done ? "Lien copié ✓" : "🔗 Copier le lien"}
    </button>
  );
}
