"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "./modal.tsx";

/** New file / import / new folder for the folder currently shown. */
export function ProjectToolbar({ slug, folderId }: { slug: string; folderId: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const base = `/api/edub/projects/${slug}`;
  const run = async (p: Promise<{ ok: boolean; data: Record<string, unknown> }>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) setErr(String(r.data.error ?? "erreur"));
    else (setErr(""), router.refresh());
  };
  return (
    <div className="toolbar">
      <button className="btn primary" disabled={busy} onClick={() => { const n = prompt("Nom du fichier", "Sans titre"); if (n) void run(api("POST", `${base}/files`, { name: n, folderId })); }}>+ Nouveau fichier</button>
      <button className="btn" disabled={busy} onClick={() => input.current?.click()}>Importer .op / .pen / .fig</button>
      <button className="btn" disabled={busy} onClick={() => { const n = prompt("Nom du dossier"); if (n) void run(api("POST", `${base}/folders`, { name: n, parentId: folderId })); }}>+ Dossier</button>
      <input ref={input} type="file" accept=".op,.pen,.fig" hidden onChange={(e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const fd = new FormData();
        fd.set("file", f);
        if (folderId) fd.set("folderId", folderId);
        void run(api("POST", `${base}/files`, fd));
        e.target.value = "";
      }} />
      {err ? <span className="err">{err}</span> : null}
    </div>
  );
}
