"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Job = { name: string; state: "wait" | "up" | "ok" | "err"; msg?: string };

/**
 * Drag & drop (several files), paste from the clipboard, or the file picker (on mobile this opens the
 * photo gallery). Section and platform come from where the user is. One request per file, 3 in parallel.
 */
export function Uploader({ slug, sectionId, platform, screenId }: { slug: string; sectionId?: string | null; platform?: string | null; screenId?: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [over, setOver] = useState(false);
  const [plat, setPlat] = useState(platform ?? "");
  const platRef = useRef(plat);
  platRef.current = plat;

  const send = useCallback(
    async (files: File[]) => {
      const list = files.filter((f) => f.type.startsWith("image/") || /\.html?$/i.test(f.name) || f.type === "text/html");
      if (!list.length) return;
      const start = jobs.length;
      setJobs((j) => [...j, ...list.map((f) => ({ name: f.name, state: "wait" as const }))]);
      const set = (i: number, p: Partial<Job>) => setJobs((j) => j.map((x, k) => (k === start + i ? { ...x, ...p } : x)));
      let next = 0;
      const worker = async () => {
        for (let i = next++; i < list.length; i = next++) {
          set(i, { state: "up" });
          const fd = new FormData();
          fd.set("file", list[i]!);
          if (!screenId) {
            if (sectionId) fd.set("sectionId", sectionId);
            if (platRef.current) fd.set("platform", platRef.current);
          }
          const res = await fetch(screenId ? `/api/edub/projects/${slug}/screens/${screenId}/versions` : `/api/edub/projects/${slug}/screens`, { method: "POST", body: fd }).catch(() => null);
          if (res?.ok) set(i, { state: "ok" });
          else set(i, { state: "err", msg: String(((await res?.json().catch(() => ({}))) as { error?: string })?.error ?? "réseau") });
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      router.refresh();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs.length, slug, sectionId, screenId],
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        void send(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `capture-${Date.now()}-${i}.png`, { type: f.type }))));
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [send]);

  const done = jobs.filter((j) => j.state === "ok").length;
  return (
    <div
      className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); void send([...e.dataTransfer.files]); }}
    >
      <div className="row-actions">
        <button className="btn primary" onClick={() => input.current?.click()}>{screenId ? "+ Nouvelle version" : "+ Ajouter des écrans"}</button>
        {!screenId ? (
          <select value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Plateforme des nouveaux écrans">
            <option value="">Plateforme : autre</option>
            {["ios", "android", "web", "watch", "desktop", "email"].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : null}
        <span className="muted small">ou glisse des images / maquettes .html ici, ou colle une capture (Ctrl/⌘+V)</span>
      </div>
      <input ref={input} type="file" accept="image/*,.html,.htm,text/html" multiple={!screenId} hidden onChange={(e) => { void send([...(e.target.files ?? [])]); e.target.value = ""; }} />
      {jobs.length ? (
        <ul className="jobs" aria-live="polite">
          <li className="muted small">{done}/{jobs.length} envoyés <button className="link" onClick={() => setJobs([])}>effacer</button></li>
          {jobs.filter((j) => j.state === "err" || j.state === "up").slice(0, 6).map((j, i) => <li key={i} className={j.state === "err" ? "err" : "small"}>{j.name} — {j.state === "err" ? j.msg : "envoi…"}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
