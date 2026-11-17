"use client";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Native <dialog> whose open state is mirrored in the history stack: the back gesture /
 * browser Back closes it instead of leaving the page (mobile). `children` receives `dismiss`.
 */
export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: (dismiss: () => void) => ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const dismiss = () => history.back();
  useEffect(() => {
    const d = ref.current;
    if (!d || !open) return;
    d.showModal();
    history.pushState({ edubModal: true }, "");
    const onPop = () => onClose();
    const onCancel = (e: Event) => {
      e.preventDefault();
      history.back();
    };
    window.addEventListener("popstate", onPop);
    d.addEventListener("cancel", onCancel);
    return () => {
      window.removeEventListener("popstate", onPop);
      d.removeEventListener("cancel", onCancel);
      if (d.open) d.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <dialog ref={ref} className="modal" onClick={(e) => e.target === ref.current && dismiss()}>
      <div className="modal-head">
        <h3>{title}</h3>
        <button className="icon-btn" onClick={dismiss} aria-label="Fermer">
          ✕
        </button>
      </div>
      <div className="modal-body">{children(dismiss)}</div>
    </dialog>
  );
}

export async function api(method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method,
    headers: body instanceof FormData || body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}
