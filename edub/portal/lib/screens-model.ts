import type { ScreenLink } from "./db/schema.ts";

/** Pure vocabulary + validation of the screen gallery (no I/O; unit-tested in screens-model.test.ts). */
export const PLATFORMS = ["ios", "android", "web", "watch", "desktop", "email", "autre"] as const;
export const TYPES = ["capture", "maquette-html", "design"] as const;
export const STATUSES = ["proposé", "validé", "en prod", "obsolète"] as const;
export type Platform = (typeof PLATFORMS)[number];
export type ScreenType = (typeof TYPES)[number];
export type ScreenStatus = (typeof STATUSES)[number];

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_HTML_BYTES = 8 * 1024 * 1024;
export const BOARD_URL = "https://dev.edub.fr/?todo=";

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .trim();

/** Accepts the accented form and the ASCII ones agents tend to send (`propose`, `en-prod`, `html`). */
export function parsePlatform(raw: unknown): Platform | null {
  if (typeof raw !== "string") return null;
  const v = fold(raw);
  return (PLATFORMS as readonly string[]).includes(v) ? (v as Platform) : null;
}
export function parseStatus(raw: unknown): ScreenStatus | null {
  if (typeof raw !== "string") return null;
  const v = fold(raw);
  return STATUSES.find((s) => fold(s) === v) ?? null;
}
export function parseType(raw: unknown): ScreenType | null {
  if (typeof raw !== "string") return null;
  const v = fold(raw);
  if (v === "html" || v === "maquette") return "maquette-html";
  if (v === "image") return "capture";
  return (TYPES as readonly string[]).includes(v) ? (v as ScreenType) : null;
}

const TICKET_RE = /\bED_\d{3,6}\b/g;
export const TICKET_ONE = /^ED_\d{3,6}$/;
export const extractTickets = (text: string): string[] => [...new Set(text.toUpperCase().match(TICKET_RE) ?? [])];

export const ticketUrl = (id: string) => `${BOARD_URL}${encodeURIComponent(id)}`;

/** http(s) only: a `javascript:` link would run in the portal origin. */
export function safeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Free-form link inputs (`"ED_1234"`, a URL, or `{type, ref|url, label}`) → typed links. */
export function parseLinks(raw: unknown): ScreenLink[] | null {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 50) return null;
  const out: ScreenLink[] = [];
  for (const item of raw) {
    let value = "";
    let label: string | undefined;
    if (typeof item === "string") value = item.trim();
    else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      value = String(o.ref ?? o.url ?? "").trim();
      if (typeof o.label === "string" && o.label.trim()) label = o.label.trim().slice(0, 120);
    } else return null;
    if (!value) continue;
    if (TICKET_ONE.test(value.toUpperCase())) {
      out.push({ type: "ticket", ref: value.toUpperCase(), ...(label ? { label } : {}) });
      continue;
    }
    const url = safeUrl(value);
    if (!url) return null;
    out.push({ type: /\/pulls?\/\d+|\/merge_requests\/\d+/.test(url) ? "pr" : "url", url, ...(label ? { label } : {}) });
  }
  return out;
}

export const ticketsOfLinks = (links: ScreenLink[]): string[] => [...new Set(links.filter((l) => l.type === "ticket" && l.ref).map((l) => l.ref!))];

export function parseTags(raw: unknown): string[] | null {
  if (raw === undefined || raw === null || raw === "") return [];
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
  if (!list || list.length > 30) return null;
  const tags = new Set<string>();
  for (const t of list) {
    if (typeof t !== "string") return null;
    const v = t.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 40);
    if (v) tags.add(v);
  }
  return [...tags];
}

/** `@alice` tokens of a comment, lowercased, de-duplicated (membership is checked by the caller). */
export function extractMentions(body: string): string[] {
  return [...new Set([...body.matchAll(/(?:^|[^\w@.])@([a-z0-9][a-z0-9._-]{0,63})/gi)].map((m) => m[1]!.toLowerCase().replace(/[.-]+$/, "")))];
}

/**
 * Response headers for user-supplied HTML. `sandbox` WITHOUT `allow-same-origin` gives the document
 * an opaque origin even when opened directly: no portal cookie, no same-origin fetch. The rest locks
 * network egress (`connect-src 'none'`), form posts, plugins and base-tag tricks.
 */
export const HTML_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline' https:",
  "img-src data: blob: https:",
  "font-src data: https:",
  "media-src data: blob: https:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join("; ");

export type Detected = { kind: "image"; mime: string; ext: string } | { kind: "html"; mime: "text/html"; ext: "html" };

const IMAGE_FORMATS: Record<string, { mime: string; ext: string }> = {
  png: { mime: "image/png", ext: "png" },
  jpeg: { mime: "image/jpeg", ext: "jpg" },
  webp: { mime: "image/webp", ext: "webp" },
  gif: { mime: "image/gif", ext: "gif" },
  avif: { mime: "image/avif", ext: "avif" },
  heif: { mime: "image/avif", ext: "avif" },
};
export const imageFormat = (sharpFormat: string | undefined) => (sharpFormat ? IMAGE_FORMATS[sharpFormat] ?? null : null);

export const looksLikeHtml = (filename: string, mime: string | undefined, head: string): boolean =>
  /\.html?$/i.test(filename) || mime === "text/html" || /^\s*(<!doctype html|<html[\s>])/i.test(head);

export const titleFromFilename = (name: string): string =>
  name.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Sans titre";
