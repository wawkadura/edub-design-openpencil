import path from "node:path";

/**
 * Makes an HTML mockup self-contained: relative stylesheets, scripts, images and `url(...)` become
 * inline / `data:` URIs. The gallery sandbox (no same-origin, no network) can then render it as is,
 * and the stored file does not depend on the source tree any more. Pure: the file system is `fetchRef`.
 */
export type Fetched = { abs: string; data: Buffer };
export type FetchRef = (baseDir: string, ref: string) => Fetched | null;
export type InlineReport = { inlined: number; missing: string[] };

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", json: "application/json",
};
const mimeOf = (abs: string) => MIME[abs.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

/** Refs left alone: remote, already inline, anchors, template placeholders. */
export const isLocalRef = (ref: string): boolean => !!ref && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) && !/[{}$'"+]/.test(ref);
const clean = (ref: string) => ref.replace(/[?#].*$/, "");
const dataUri = (f: Fetched) => `data:${mimeOf(f.abs)};base64,${f.data.toString("base64")}`;

/** `url(...)` inside CSS text (a stylesheet or a `<style>` block), resolved from `baseDir`. */
function inlineCssUrls(css: string, baseDir: string, fetchRef: FetchRef, rep: InlineReport, depth: number): string {
  const withImports = css.replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?[^;]*;/g, (all, _q: string, ref: string) => {
    if (!isLocalRef(ref) || depth > 3) return all;
    const f = fetchRef(baseDir, clean(ref));
    if (!f) return (rep.missing.push(ref), all);
    rep.inlined++;
    return inlineCssUrls(f.data.toString("utf8"), path.posix.dirname(f.abs), fetchRef, rep, depth + 1);
  });
  return withImports.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (all, _q: string, ref: string) => {
    if (!isLocalRef(ref.trim())) return all;
    const f = fetchRef(baseDir, clean(ref.trim()));
    if (!f) return (rep.missing.push(ref.trim()), all);
    rep.inlined++;
    return `url("${dataUri(f)}")`;
  });
}

const attr = (tag: string, name: string): string | null => tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"))?.slice(1).find((x) => x !== undefined) ?? null;
const setAttr = (tag: string, name: string, value: string) => tag.replace(new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`, "i"), (_m, p: string) => `${p}"${value}"`);
const escScript = (js: string) => js.replace(/<\/(script)/gi, "<\\/$1");

export function inlineHtml(html: string, baseDir: string, fetchRef: FetchRef): { html: string; report: InlineReport } {
  const rep: InlineReport = { inlined: 0, missing: [] };
  const out = html
    // <link rel="stylesheet" href="x.css"> → <style>
    .replace(/<link\b[^>]*>/gi, (tag) => {
      const href = attr(tag, "href");
      if (!href || !/\brel\s*=\s*["']?stylesheet/i.test(tag) || !isLocalRef(href)) return tag;
      const f = fetchRef(baseDir, clean(href));
      if (!f) return (rep.missing.push(href), tag);
      rep.inlined++;
      return `<style>${inlineCssUrls(f.data.toString("utf8"), path.posix.dirname(f.abs), fetchRef, rep, 0).replace(/<\/style/gi, "<\\/style")}</style>`;
    })
    // <script src="x.js"></script> → inline script
    .replace(/<script\b([^>]*)>\s*<\/script>/gi, (all, attrs: string) => {
      const src = attr(`<script${attrs}>`, "src");
      if (!src || !isLocalRef(src)) return all;
      const f = fetchRef(baseDir, clean(src));
      if (!f) return (rep.missing.push(src), all);
      rep.inlined++;
      return `<script${attrs.replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*')/i, "")}>${escScript(f.data.toString("utf8"))}</script>`;
    })
    // <style> blocks and style="" attributes
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a: string, css: string, b: string) => a + inlineCssUrls(css, baseDir, fetchRef, rep, 0) + b)
    .replace(/\bstyle\s*=\s*"([^"]*url\([^"]*)"/gi, (_m, css: string) => `style="${inlineCssUrls(css, baseDir, fetchRef, rep, 0).replace(/"/g, "'")}"`)
    // <img src>, <source src>, <image href>, <video poster>, <use href> (files only)
    .replace(/<(img|source|image|video|use)\b[^>]*>/gi, (tag) => {
      let t = tag;
      for (const name of ["src", "href", "poster", "xlink:href"]) {
        const ref = attr(t, name);
        if (!ref || !isLocalRef(ref)) continue;
        const f = fetchRef(baseDir, clean(ref));
        if (!f) {
          rep.missing.push(ref);
          continue;
        }
        rep.inlined++;
        t = setAttr(t, name, dataUri(f));
      }
      return t;
    });
  return { html: out, report: rep };
}
