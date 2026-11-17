"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, Modal } from "./modal.tsx";

export function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>
        + Nouveau projet
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Nouveau projet">
        {(dismiss) => (
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const r = await api("POST", "/api/edub/projects", {
                name: f.get("name"),
                emoji: f.get("emoji") || undefined,
                color: f.get("color"),
                description: f.get("description") || undefined,
              });
              if (!r.ok) return setErr(String(r.data.error ?? "erreur"));
              dismiss();
              router.refresh();
            }}
          >
            <label>Nom<input name="name" required maxLength={80} placeholder="TamaFit" /></label>
            <div className="row">
              <label>Emoji<input name="emoji" maxLength={4} placeholder="🐣" /></label>
              <label>Couleur<input name="color" type="color" defaultValue="#7c6cff" /></label>
            </div>
            <label>Description<input name="description" maxLength={500} /></label>
            {err ? <p className="err">{err}</p> : null}
            <button className="btn primary">Créer</button>
          </form>
        )}
      </Modal>
    </>
  );
}
