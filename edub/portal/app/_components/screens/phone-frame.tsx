"use client";
import type { CSSProperties } from "react";

/**
 * Untrusted HTML mockup. `sandbox="allow-scripts"` WITHOUT `allow-same-origin`: the document gets an
 * opaque origin (no portal cookie, no access to the parent), on top of the CSP the file route sends.
 */
export function MockupFrame({ src, phone, title, style }: { src: string; phone: boolean; title: string; style?: CSSProperties }) {
  return (
    <div className={phone ? "phone" : "browser"} style={style}>
      <iframe src={src} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" loading="lazy" className="mockup" />
    </div>
  );
}
