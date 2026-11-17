"use client";
import { useState } from "react";
import { MockupFrame } from "./phone-frame.tsx";

export type Side = { label: string; src: string; kind: "image" | "html"; w: number | null; h: number | null };
type Mode = "side" | "slider" | "diff";

function Pane({ s, style }: { s: Side; style?: React.CSSProperties }) {
  // eslint-disable-next-line @next/next/no-img-element
  return s.kind === "html" ? <MockupFrame src={s.src} phone={false} title={s.label} style={{ ...style, width: 390, height: 844 }} /> : <img src={s.src} alt={s.label} style={style} className="cmp-img" />;
}

/** Side by side, overlay with a slider, or "differences" (CSS `mix-blend-mode: difference`: black = identical). */
export function CompareView({ a, b }: { a: Side; b: Side }) {
  const [mode, setMode] = useState<Mode>("side");
  const [pos, setPos] = useState(50);
  const ratio = a.kind === "html" ? "390 / 844" : a.w && a.h ? `${a.w} / ${a.h}` : "9 / 19.5";
  return (
    <div>
      <div className="viewer-bar" role="tablist">
        {([["side", "Côte à côte"], ["slider", "Curseur"], ["diff", "Différences"]] as const).map(([m, l]) => <button key={m} role="tab" aria-selected={mode === m} className={`btn${mode === m ? " primary" : ""}`} onClick={() => setMode(m)}>{l}</button>)}
      </div>
      {mode === "side" ? (
        <div className="cmp-side">
          {[a, b].map((s, i) => <figure key={i}><figcaption className="small">{s.label}</figcaption><Pane s={s} /></figure>)}
        </div>
      ) : (
        <div className="cmp-over">
          <p className="small muted">{mode === "slider" ? `${a.label} | ${b.label}` : "Noir = identique ; couleur = différence"}</p>
          <div className="cmp-stack" style={{ aspectRatio: ratio, maxWidth: a.kind === "html" ? 390 : 520 }}>
            <div className="cmp-layer"><Pane s={a} style={{ width: "100%", height: "100%", objectFit: "fill" }} /></div>
            <div className="cmp-layer" style={mode === "slider" ? { clipPath: `inset(0 0 0 ${pos}%)` } : { mixBlendMode: "difference" }}><Pane s={b} style={{ width: "100%", height: "100%", objectFit: "fill" }} /></div>
            {mode === "slider" ? <div className="cmp-handle" style={{ left: `${pos}%` }} /> : null}
          </div>
          {mode === "slider" ? <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Curseur de comparaison" className="cmp-range" /> : null}
        </div>
      )}
    </div>
  );
}
