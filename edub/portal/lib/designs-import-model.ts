import type { Platform, ScreenStatus } from "./screens-model.ts";

/**
 * Pure rules of the TamaFit `docs/designs` import (no I/O; unit-tested in designs-import.test.ts).
 * Everything is keyed by the POSIX path relative to `docs/designs` (the idempotency key).
 */
export const RESOURCES = "Ressources";
export const RESOURCE_ROOTS = ["assets", "exercise-images"] as const;
const IMAGE_EXT = new Set(["png", "webp", "jpg", "jpeg"]);

export type Kind = "capture" | "maquette-html" | "svg" | "note" | "ignored";

export const extOf = (rel: string): string => rel.split("/").pop()!.split(".").slice(1).pop()?.toLowerCase() ?? "";
export const stemOf = (rel: string): string => rel.split("/").pop()!.replace(/\.[a-z0-9]+$/i, "");
export const dirOf = (rel: string): string => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");

export function classify(rel: string): { kind: Kind; reason?: string } {
  const ext = extOf(rel);
  if (!rel.includes("/")) {
    if (rel === "index.html") return { kind: "ignored", reason: "galerie statique de la source, remplacée par la galerie Edub Design" };
    if (rel === "README.md") return { kind: "ignored", reason: "convention de la source (HTML autonomes), sans objet ici" };
    return { kind: "ignored", reason: "fichier racine partagé (CSS/JS intégré aux maquettes HTML qui le référencent, pas un écran)" };
  }
  if (IMAGE_EXT.has(ext)) return { kind: "capture" };
  if (ext === "html" || ext === "htm") return { kind: "maquette-html" };
  if (ext === "svg") return { kind: "svg" };
  if (ext === "md") return { kind: "note" };
  return { kind: "ignored", reason: `.${ext || "?"} : ressource technique, pas un écran (intégrée aux maquettes HTML qui la référencent)` };
}

const words = (s: string) => s.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
const cap = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
export const humanize = (name: string): string => cap(words(name));
export const titleOf = (rel: string): string => cap(words(stemOf(rel))) || "Sans titre";

export type Place = { root: string; sub: string | null; deeper: string[] };

/** 1 folder = 1 section, its sub-folders = sub-sections (the gallery nests ONE level: deeper folders fold into tags). */
export function placeOf(rel: string): Place {
  const parts = dirOf(rel).split("/").filter(Boolean);
  const first = parts[0]!;
  if ((RESOURCE_ROOTS as readonly string[]).includes(first)) {
    return { root: RESOURCES, sub: parts.length > 1 ? `${first} / ${parts[1]}` : first, deeper: parts.slice(2) };
  }
  return { root: humanize(first.replace(/^_/, "")), sub: parts[1] ? humanize(parts[1]) : null, deeper: parts.slice(2) };
}

export const isResource = (rel: string): boolean => (RESOURCE_ROOTS as readonly string[]).includes(rel.split("/")[0] ?? "");
export const isArchived = (rel: string): boolean => dirOf(rel).split("/").some((p) => /^archive/i.test(p));

export function statusOf(rel: string): ScreenStatus {
  if (isArchived(rel)) return "obsolète";
  return isResource(rel) ? "en prod" : "proposé";
}

const WATCH = new Set(["watch", "wear", "wearos", "apple-watch", "applewatch", "wear-os"]);

/** Platform from the folder / file name tokens, `autre` when nothing says it. */
export function platformOf(rel: string): Platform {
  const parts = [...dirOf(rel).split("/"), stemOf(rel)].filter(Boolean).map((p) => p.toLowerCase().replace(/^_/, ""));
  const tokens = parts.flatMap((p) => [p, ...p.split(/[-_ .]+/)]);
  if (tokens.some((t) => WATCH.has(t))) return "watch";
  if (tokens.some((t) => t === "emails" || t === "email")) return "email";
  if (tokens.some((t) => t === "ios" || t === "iphone")) return "ios";
  if (tokens.some((t) => t === "android")) return "android";
  return "autre";
}

export function tagsOf(rel: string): string[] {
  const place = placeOf(rel);
  const tags = new Set<string>([rel.split("/")[0]!.replace(/^_/, "").toLowerCase()]);
  if (isResource(rel)) tags.add("ressource");
  for (const d of place.deeper) tags.add(d.toLowerCase());
  const v = stemOf(rel).match(/(?:^|[-_])(v\d+)(?:[-_]|$)/i);
  if (v) tags.add(v[1]!.toLowerCase());
  return [...tags];
}

/**
 * HTML ↔ PNG pairs: same stem in the same folder, or `<stem>-overview.png` for `<stem>.html`.
 * Returns html path → png path (each PNG used once, only when it is clearly that HTML's rendering).
 */
export function pairHtmlPng(files: string[]): Map<string, string> {
  const set = new Set(files);
  const pairs = new Map<string, string>();
  for (const f of files) {
    if (extOf(f) !== "html") continue;
    const base = f.slice(0, -".html".length);
    const png = [`${base}.png`, `${base}-overview.png`].find((c) => set.has(c));
    if (png) pairs.set(f, png);
  }
  return pairs;
}

/** `*.md` → where it goes: the screen with the same stem in the same folder, else its folder's section. */
export function noteTarget(rel: string, screens: Set<string>): { screen: string } | { dir: string } {
  const dir = dirOf(rel);
  const candidate = [`${dir}/${stemOf(rel)}.html`, `${dir}/${stemOf(rel)}.png`].find((c) => screens.has(c));
  return candidate ? { screen: candidate } : { dir };
}

/** Folder of a note → the (root, sub) section it describes (same folding as screens). */
export function sectionOfDir(dir: string): Place {
  return placeOf(`${dir}/x`);
}
