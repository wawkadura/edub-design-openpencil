/**
 * Import of the TamaFit repo's `docs/designs` into the Edub Design project `tamafit` (ED_1733).
 *
 *   npx tsx scripts/import-tamafit-designs.ts --source /path/to/tamafit-app/docs/designs [options]
 *
 * Options:
 *   --dry-run        plan + report only, no DB, no disk write (also the default when no DB env is set)
 *   --dates <file>   JSON { "<path relative to --source>": "<ISO date>" } (last commit date of each file);
 *                    without it: `git log` in the source repo when readable, else the file mtime
 *   --repo-root <d>  second root allowed for relative asset refs (default: two levels above --source)
 *   --report <file>  write the markdown report there (default: stdout)
 *   --owner <user>   owner when the project has to be created (default EDUB_DESIGN_SEED_OWNER or "edub")
 *
 * Idempotent: key = POSIX path relative to --source (screen.source_key). Same bytes → untouched;
 * changed bytes → new version. The source is only ever READ. Rights are never touched (the project
 * keeps its owner only; Walid shares it afterwards).
 */
import { config } from "dotenv";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { inlineHtml, type FetchRef } from "../lib/designs-import-inline.ts";
import {
  classify, dirOf, extOf, isResource, noteTarget, pairHtmlPng, placeOf, platformOf, RESOURCES, sectionOfDir, statusOf, stemOf, tagsOf, titleOf,
} from "../lib/designs-import-model.ts";

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : undefined);
const SOURCE = path.resolve(opt("source") ?? "");
if (!opt("source")) throw new Error("--source <docs/designs dir> requis");
const REPO_ROOT = path.resolve(opt("repo-root") ?? path.join(SOURCE, "..", ".."));
const DRY = argv.includes("--dry-run");
const AUTHOR = "import-tamafit";
const ASSET_EXT = new Set(["css", "js", "png", "webp", "jpg", "jpeg", "gif", "svg", "ttf", "woff", "woff2", "otf"]);

/* ───────── source scan (read-only) ───────── */

const files: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs);
    else if (e.isFile()) files.push(path.relative(SOURCE, abs).split(path.sep).join("/"));
  }
})(SOURCE);
files.sort();

function loadDates(): Map<string, Date> {
  const out = new Map<string, Date>();
  const f = opt("dates");
  if (f) {
    for (const [k, v] of Object.entries(JSON.parse(readFileSync(f, "utf8")) as Record<string, string>)) out.set(k, new Date(v));
    return out;
  }
  try {
    const top = execFileSync("git", ["-c", "safe.directory=*", "-C", SOURCE, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
    const prefix = path.relative(top, SOURCE).split(path.sep).join("/");
    const log = execFileSync("git", ["-c", "safe.directory=*", "-C", top, "log", "--format=@@%cI", "--name-only", "--", prefix], { encoding: "utf8", maxBuffer: 1 << 28 });
    let when: Date | null = null;
    for (const line of log.split("\n")) {
      if (line.startsWith("@@")) when = new Date(line.slice(2));
      else if (line && when && line.startsWith(prefix + "/")) {
        const rel = line.slice(prefix.length + 1);
        if (!out.has(rel)) out.set(rel, when); // newest first: keep the first hit
      }
    }
  } catch {
    /* no readable git: mtime */
  }
  return out;
}
const dates = loadDates();
const dateOf = (rel: string): { d: Date; src: "git" | "mtime" } => {
  const g = dates.get(rel);
  return g && !Number.isNaN(g.getTime()) ? { d: g, src: "git" } : { d: statSync(path.join(SOURCE, rel)).mtime, src: "mtime" };
};

const cache = new Map<string, Buffer | null>();
const readCached = (abs: string): Buffer | null => {
  if (!cache.has(abs)) {
    try {
      const st = statSync(abs);
      cache.set(abs, st.isFile() && st.size <= 6 * 1024 * 1024 ? readFileSync(abs) : null);
    } catch {
      cache.set(abs, null);
    }
  }
  return cache.get(abs)!;
};
const inside = (root: string, abs: string) => abs === root || abs.startsWith(root + path.sep);
let fallbacks = 0;
let built = 0;
const webpCache = new Map<string, Buffer>();
const webpSmall = new Map<string, Buffer>();
/** Lookup that does not count as a stale-path fallback in the report. */
const mimeOfExt = (abs: string) => (/\.svg$/i.test(abs) ? "image/svg+xml" : /\.png$/i.test(abs) ? "image/png" : /\.webp$/i.test(abs) ? "image/webp" : "image/jpeg");
const quiet = (base: string, ref: string) => {
  const n = fallbacks;
  const f = fetchRef(base, ref);
  fallbacks = n;
  return f;
};
/** Swaps `src` of images whose script-built path is in the embedded map (also for nodes added later). */
const SHIM =
  "(function(){var M=window.__EA,F=window.__EF;" +
  "function f(e){if(!e.getAttribute)return;var v=e.getAttribute('src');if(v&&v.slice(0,5)!=='data:'){v=v.replace(/[?#].*$/,'');if(M[v]!==undefined)e.setAttribute('src',F[M[v]])}" +
  "var st=e.getAttribute('style');if(st&&st.indexOf('url(')>-1){var n=st.replace(/url\\((['\"]?)([^'\")]+)\\1\\)/g,function(m,q,u){u=u.replace(/[?#].*$/,'');return M[u]!==undefined?\"url('\"+F[M[u]]+\"')\":m});if(n!==st)e.setAttribute('style',n)}}" +
  "function all(n){f(n);if(n.querySelectorAll){var l=n.querySelectorAll('img,source,[style*=\"url(\"]');for(var i=0;i<l.length;i++)f(l[i])}}" +
  "new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==='attributes')f(m.target);else m.addedNodes.forEach(all)})}).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['src','style']});" +
  "document.addEventListener('DOMContentLoaded',function(){all(document)})})();";
/**
 * Relative asset refs may resolve in the designs tree or in the app repo (never elsewhere). A ref that
 * climbs too high (stale `../../../../assets/…` of moved mockups) is retried from the repo root, then
 * from the designs root, with its leading `../` stripped.
 */
const fetchRef: FetchRef = (baseDir, ref) => {
  let want: string;
  try {
    want = decodeURIComponent(ref);
  } catch {
    return null;
  }
  const bare = want.replace(/^(\.\.\/)+/, "");
  const first = path.resolve(baseDir, want);
  for (const [i, abs] of [first, path.join(REPO_ROOT, bare), path.join(SOURCE, bare)].entries()) {
    if (!(inside(SOURCE, abs) || inside(REPO_ROOT, abs)) || !ASSET_EXT.has(extOf(abs))) continue;
    const data = readCached(abs);
    if (!data) continue;
    if (i > 0) fallbacks++;
    return { abs: abs.split(path.sep).join("/"), data };
  }
  return null;
};

/* ───────── plan ───────── */

type Entry = { rel: string; kind: "capture" | "maquette-html" | "svg" | "note" | "ignored"; reason?: string };
const entries: Entry[] = files.map((rel) => ({ rel, ...classify(rel) }));
const pairs = pairHtmlPng(files.filter((f) => classify(f).kind === "maquette-html" || classify(f).kind === "capture"));
const renderPngs = new Set(pairs.values());
const screenKeys = new Set(entries.filter((e) => ["capture", "maquette-html", "svg"].includes(e.kind) && !renderPngs.has(e.rel)).map((e) => e.rel));

/** Screen notes (same stem) vs section notes (folder). README first, then the others by name. */
const screenNotes = new Map<string, string>();
const sectionNotes = new Map<string, string[]>();
for (const e of entries.filter((x) => x.kind === "note")) {
  const text = readFileSync(path.join(SOURCE, e.rel), "utf8").trim();
  const t = noteTarget(e.rel, screenKeys);
  if ("screen" in t) screenNotes.set(t.screen, text);
  else {
    const list = sectionNotes.get(t.dir) ?? [];
    list.push(/(^|\/)README\.md$/.test(e.rel) ? text : `## ${stemOf(e.rel)}\n\n${text}`);
    sectionNotes.set(t.dir, list);
  }
}

const report = {
  sections: new Set<string>(),
  roots: new Set<string>(),
  byKind: { capture: 0, "maquette-html": 0, svg: 0 } as Record<string, number>,
  byOutcome: { created: 0, "new-version": 0, unchanged: 0 } as Record<string, number>,
  byPlatform: {} as Record<string, number>,
  byStatus: {} as Record<string, number>,
  resources: 0,
  notes: { screen: 0, section: 0 },
  ignored: [] as { rel: string; reason: string }[],
  paired: [] as [string, string][],
  anomalies: [] as string[],
  inlined: 0,
  datesFrom: { git: 0, mtime: 0 },
  files: files.length,
};
for (const e of entries) if (e.kind === "ignored") report.ignored.push({ rel: e.rel, reason: e.reason! });

/* ───────── execution ───────── */

type Ctx = { project: import("../lib/db/schema.ts").Project; sections: Map<string, string> };
let ctx: Ctx | null = null;
let lib: typeof import("../lib/screens-import.ts") | null = null;

async function sectionIdFor(place: { root: string; sub: string | null }): Promise<string | null> {
  report.roots.add(place.root);
  if (place.sub) report.sections.add(`${place.root} / ${place.sub}`);
  if (!ctx || !lib) return null;
  const key = place.sub ? `${place.root}\u0000${place.sub}` : place.root;
  if (!ctx.sections.has(key)) {
    const root = ctx.sections.has(place.root) ? { id: ctx.sections.get(place.root)! } : await lib.ensureSection(ctx.project.id, null, place.root);
    ctx.sections.set(place.root, root.id);
    if (place.sub) ctx.sections.set(key, (await lib.ensureSection(ctx.project.id, root.id, place.sub)).id);
  }
  return ctx.sections.get(key) ?? null;
}

async function toUpload(e: Entry): Promise<{ filename: string; data: Buffer } | null> {
  const abs = path.join(SOURCE, e.rel);
  if (e.kind === "svg") {
    try {
      return { filename: `${stemOf(e.rel)}.png`, data: await sharp(readFileSync(abs), { density: 144, limitInputPixels: 120_000_000 }).png().toBuffer() };
    } catch (err) {
      report.anomalies.push(`${e.rel} : SVG illisible (${err instanceof Error ? err.message : err}), ignoré`);
      return null;
    }
  }
  if (e.kind === "maquette-html") {
    const base = path.dirname(abs).split(path.sep).join("/");
    let r = inlineHtml(readFileSync(abs, "utf8"), base, fetchRef);
    if (Buffer.byteLength(r.html) > 7.5 * 1024 * 1024) {
      // Same image repeated many times: re-encode the big rasters as webp (lossy) so the mockup fits the 8 MB limit.
      const small = new Map<string, Buffer>();
      const jobs: Promise<void>[] = [];
      const shrinkRef: FetchRef = (b, ref) => {
        const f = fetchRef(b, ref);
        if (!f || !/\.(png|jpe?g)$/i.test(f.abs) || f.data.length <= 20_000) return f;
        const hit = small.get(f.abs);
        return hit ? { abs: f.abs.replace(/\.[a-z]+$/i, ".webp"), data: hit } : f;
      };
      const src = readFileSync(abs, "utf8");
      for (const m of src.matchAll(/(?:src|href)\s*=\s*["']([^"'#?]+)["']|url\(\s*['"]?([^)'"#?]+)['"]?\s*\)/g)) {
        const ref = m[1] ?? m[2];
        const f = ref ? fetchRef(base, ref) : null;
        if (f && /\.(png|jpe?g)$/i.test(f.abs) && f.data.length > 20_000 && !small.has(f.abs)) {
          small.set(f.abs, f.data);
          jobs.push(sharp(f.data).webp({ quality: 72 }).toBuffer().then((b) => void small.set(f.abs, b)));
        }
      }
      await Promise.all(jobs);
      r = inlineHtml(src, base, shrinkRef);
      report.anomalies.push(`${e.rel} : trop lourd une fois autonome, images raster ré-encodées en WebP (qualité 72) pour tenir sous 8 Mo`);
    }
    // Paths BUILT by a script (`imgDepth + 'assets/…png`, shared.js placeholders): inline them as data URIs too.
    r.html = r.html.replace(/\b[A-Za-z_]\w*\s*\+\s*'(assets\/[^'"\\]+\.(?:png|jpe?g|webp))/g, (all, ref: string) => {
      const f = quiet(base, `../../../../${ref}`);
      if (!f) return all;
      built++;
      return `'data:${/\.png$/i.test(ref) ? "image/png" : /\.webp$/i.test(ref) ? "image/webp" : "image/jpeg"};base64,${f.data.toString("base64")}`;
    });
    // Template literals `../assets/dir/${name}.svg`: embed that folder's files in a map and read from it.
    const assetMap: Record<string, number> = {};
    const efiles: string[] = [];
    const efIndex = new Map<string, number>();
    const addFile = (f: { abs: string; data: Buffer }): number => {
      let i = efIndex.get(f.abs);
      if (i === undefined) {
        i = efiles.push(`data:${mimeOfExt(f.abs)};base64,${f.data.toString("base64")}`) - 1;
        efIndex.set(f.abs, i);
      }
      return i;
    };
    r.html = r.html.replace(/((?:\.\.\/)+[A-Za-z0-9_./-]+\/)\$\{([^}]+)\}(\.(?:svg|png|webp|jpg))/g, (all, dirRef: string, expr: string, ext: string) => {
      const dir = [path.resolve(base, dirRef), path.join(REPO_ROOT, dirRef.replace(/^(\.\.\/)+/, "")), path.join(SOURCE, dirRef.replace(/^(\.\.\/)+/, ""))].find((d) => (inside(SOURCE, d) || inside(REPO_ROOT, d)) && existsSync(d));
      if (!dir) return all;
      const names = readdirSync(dir).filter((n) => n.endsWith(ext));
      if (names.length === 0 || names.length > 80) return all;
      for (const n of names) {
        const abs = path.join(dir, n);
        const data = readCached(abs);
        if (data) assetMap[`${dirRef}${n.slice(0, -ext.length)}${ext}`] = addFile({ abs, data });
      }
      built++;
      return `\${__EF[__EA[${JSON.stringify(dirRef)} + (${expr}) + ${JSON.stringify(ext)}]] || ""}`;
    });
    // Paths assembled at runtime (`const A='../assets/'` … `A+'decors/x.png'`, or full literals in objects): embed every
    // resolvable candidate keyed by the string the script will build, and swap `src` on the fly (see SHIM).
    const prefixes = new Set([""]);
    const up: string[] = [];
    const rel: string[] = [];
    // Directory literals: `'../assets/'` (climbing) or `'decors/variants/'` (relative, appended to another one: DV=A+'decors/variants/').
    for (const m of r.html.matchAll(/['"`]((?:\.\.?\/)*(?:[A-Za-z0-9_.-]+\/)+|(?:\.\.\/)+)['"`]/g)) (m[1]!.startsWith(".") ? up : rel).push(m[1]!);
    // Directories right before a dynamic part: `illus/rank-${set}.png`, `${A}paywall-gen/items/${img}.png`, `…/before-after/${lieu}/${obj}.png`.
    const dynDirs = new Set<string>();
    for (const m of r.html.matchAll(/['"`(=}]((?:\.\.?\/)*(?:[A-Za-z0-9_.-]+\/)+)[A-Za-z0-9_.-]*(?:\$\{|['"]\s*\+)/g)) (m[1]!.startsWith(".") ? up : rel).push(m[1]!), dynDirs.add(m[1]!);
    for (const m of r.html.matchAll(/\}((?:[A-Za-z0-9_.-]+\/)+)(?:[A-Za-z0-9_.-]*\$\{|[A-Za-z0-9_.-]+\.(?:png|webp|jpe?g|svg))/g)) rel.push(m[1]!), dynDirs.add(m[1]!);
    for (const d of rel) prefixes.add(d);
    for (const u of up) {
      prefixes.add(u);
      for (const d of rel) prefixes.add(u + d);
    }
    // File names: quoted literals AND tails inside template strings (`${IMG}bench-press.png`).
    const suffixes = new Set<string>();
    for (const m of r.html.matchAll(/(?<![A-Za-z0-9_./-])((?:\.\.?\/)*(?:[A-Za-z0-9_-][A-Za-z0-9_./-]*\/)?[A-Za-z0-9_.-]+\.(?:png|webp|jpe?g|svg))(?=['"`)\s,;}<>?#])/gi)) suffixes.add(m[1]!);
    for (const m of r.html.matchAll(/\}([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:png|webp|jpe?g|svg))/gi)) suffixes.add(m[1]!);
    let budget = 3.5 * 1024 * 1024;
    for (const pre of prefixes) {
      for (const suf of suffixes) {
        const key = pre + suf;
        if (key in assetMap || budget <= 0) continue;
        let f = quiet(base, key);
        if (!f) continue;
        if (!efIndex.has(f.abs) && /\.(png|jpe?g)$/i.test(f.abs) && f.data.length > 30_000) {
          // Script-built (dynamic) images are many and repeated: keep them light.
          const abs = f.abs;
          let w = webpCache.get(abs);
          if (!w) webpCache.set(abs, (w = await sharp(f.data).webp({ quality: 72 }).toBuffer()));
          f = { abs: `${abs}.webp`, data: w };
        }
        if (!efIndex.has(f.abs)) budget -= f.data.length * 1.34;
        assetMap[key] = addFile(f);
        built++;
      }
    }
    // File names composed at runtime (`'mascot-palm-'+g+'.webp'`, `${MUSC}${g.mus}.png`): embed the images of every directory
    // that a literal prefix points to (bounded), keyed prefix + file name.
    let dirBudget = 4 * 1024 * 1024;
    const doneDirs = new Set<string>();
    for (const pre of prefixes) {
      if (!pre) continue;
      const stripped = pre.replace(/^(\.\.?\/)+/, "");
      const dir = [path.resolve(base, pre), path.join(REPO_ROOT, stripped), path.join(SOURCE, stripped)].find((d) => (inside(SOURCE, d) || inside(REPO_ROOT, d)) && existsSync(d) && statSync(d).isDirectory());
      if (!dir || dir === SOURCE || dir === REPO_ROOT) continue;
      const deep = dynDirs.has(pre) || [...dynDirs].some((d) => pre.endsWith(d));
      const listing: string[] = [];
      (function collect(d: string, relDir: string, depth: number) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isFile() && /\.(png|webp|jpe?g|svg)$/i.test(e.name)) listing.push(relDir + e.name);
          else if (e.isDirectory() && deep && depth < 2 && !e.name.startsWith(".")) collect(path.join(d, e.name), `${relDir}${e.name}/`, depth + 1);
        }
      })(dir, "", 0);
      const names = listing.sort((x, y) => statSync(path.join(dir, x)).size - statSync(path.join(dir, y)).size);
      if (names.length === 0 || names.length > 400) continue;
      for (const n of names) {
        const key = pre + n;
        if (key in assetMap || dirBudget <= 0) continue;
        const abs = path.join(dir, n);
        let data = readCached(abs);
        if (!data) continue;
        let fabs = abs.split(path.sep).join("/");
        if (/\.(png|jpe?g)$/i.test(n) && data.length > 10_000) {
          let w = webpSmall.get(abs);
          if (!w) webpSmall.set(abs, (w = await sharp(data).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 60 }).toBuffer()));
          data = w;
          fabs = `${fabs}.webp`;
        }
        if (!efIndex.has(fabs)) dirBudget -= data.length * 1.34;
        assetMap[key] = addFile({ abs: fabs, data });
        built++;
      }
      doneDirs.add(dir);
    }
    if (dirBudget <= 0) report.anomalies.push(`${e.rel} : dossiers d'images construites par script, budget de 4 Mo atteint, les fichiers suivants restent non résolus`);
    if (budget <= 0) report.anomalies.push(`${e.rel} : images construites par script, budget de 3,5 Mo atteint, les suivantes restent non résolues`);
    if (Object.keys(assetMap).length) r.html = `<script>window.__EA=${JSON.stringify(assetMap)};window.__EF=${JSON.stringify(efiles)};${SHIM}</script>${r.html}`;
    report.inlined += r.report.inlined;
    for (const m of [...new Set(r.report.missing)]) report.anomalies.push(`${e.rel} : référence relative introuvable « ${m.slice(0, 80)} » (laissée telle quelle)`);
    return { filename: path.basename(e.rel), data: Buffer.from(r.html) };
  }
  return { filename: path.basename(e.rel), data: readFileSync(abs) };
}

async function importOne(e: Entry): Promise<void> {
  const place = placeOf(e.rel);
  const status = statusOf(e.rel);
  const platform = platformOf(e.rel);
  const tags = tagsOf(e.rel);
  const { d, src } = dateOf(e.rel);
  const up = await toUpload(e);
  if (!up) return;
  const pngRel = e.kind === "maquette-html" ? pairs.get(e.rel) : undefined;
  if (pngRel) report.paired.push([e.rel, pngRel]);
  const description = screenNotes.get(e.rel) ?? "";
  if (description) report.notes.screen++;
  const sectionId = await sectionIdFor(place);
  if (isResource(e.rel)) report.resources++;
  report.byKind[e.kind === "svg" ? "svg" : e.kind]!++;
  report.byPlatform[platform] = (report.byPlatform[platform] ?? 0) + 1;
  report.byStatus[status] = (report.byStatus[status] ?? 0) + 1;
  report.datesFrom[src]++;
  if (!ctx || !lib) return;
  try {
    const r = await lib.upsertImported(ctx.project, {
      sourceKey: e.rel, title: titleOf(e.rel), platform, status, tags: [...tags, ...(pngRel ? ["rendu-png"] : [])], description, sectionId, filename: up.filename, data: up.data, date: d,
      renderPng: pngRel ? readFileSync(path.join(SOURCE, pngRel)) : undefined, author: AUTHOR,
    });
    report.byOutcome[r.outcome]!++;
  } catch (err) {
    report.anomalies.push(`${e.rel} : import refusé (${err instanceof Error ? err.message : err})`);
  }
}

async function main() {
  config({ path: ".env.local", quiet: true });
  const live = !DRY && !!process.env.EDUB_DESIGN_DATABASE_URL;
  if (live) {
    lib = await import("../lib/screens-import.ts");
    const { getDb, schema } = await import("../lib/db/index.ts");
    const { eq } = await import("drizzle-orm");
    const db = getDb();
    const owner = opt("owner") ?? process.env.EDUB_DESIGN_SEED_OWNER ?? "edub";
    let [project] = await db.select().from(schema.projects).where(eq(schema.projects.slug, "tamafit"));
    if (!project) {
      [project] = await db.insert(schema.projects).values({ slug: "tamafit", name: "TamaFit", emoji: "🥚", color: "#f43f5e", description: "App TamaFit (mobile) : captures de QA et maquettes des agents TamaFit." }).returning();
      await db.insert(schema.projectMembers).values({ projectId: project!.id, principalKind: "user", principal: owner, role: "owner" }).onConflictDoNothing();
      console.error("projet tamafit créé (owner seul)");
    }
    ctx = { project: project!, sections: new Map() };
  } else console.error("DRY-RUN : aucune écriture");

  const todo = entries.filter((e) => screenKeys.has(e.rel));
  // Resources last so their section sorts after the features; folders alphabetical.
  todo.sort((a, b) => Number(isResource(a.rel)) - Number(isResource(b.rel)) || a.rel.localeCompare(b.rel));
  // Sections first, one at a time (parallel workers would race and create duplicates).
  for (const e of todo) await sectionIdFor(placeOf(e.rel));
  for (const dir of [...sectionNotes.keys()].sort()) await sectionIdFor(sectionOfDir(dir));
  const queue = [...todo];
  await Promise.all(Array.from({ length: 4 }, async () => { for (let e = queue.shift(); e; e = queue.shift()) await importOne(e); }));

  for (const [dir, parts] of [...sectionNotes].sort()) {
    const place = sectionOfDir(dir);
    const id = await sectionIdFor(place);
    report.notes.section++;
    if (ctx && lib && id) {
      const { getDb, schema } = await import("../lib/db/index.ts");
      const { eq } = await import("drizzle-orm");
      const [sec] = await getDb().select().from(schema.screenSections).where(eq(schema.screenSections.id, id));
      if (sec) await lib.fillSectionNote(sec, parts.join("\n\n---\n\n"));
    }
  }
  if (ctx && lib) await lib.logImport(ctx.project, AUTHOR, { ...report.byOutcome });

  const md = render(!!ctx);
  if (opt("report")) writeFileSync(opt("report")!, md);
  else console.log(md);
}

function render(live: boolean): string {
  const n = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(", ") || "—";
  const total = Object.values(report.byKind).reduce((a, b) => a + b, 0);
  const sourceCount = (exts: string[]) => files.filter((f) => exts.includes(extOf(f))).length;
  return [
    `# Import docs/designs → TamaFit (${live ? "réel" : "à blanc"})`,
    "",
    `Source : \`${SOURCE}\` (${report.files} fichiers : ${sourceCount(["png"])} png, ${sourceCount(["webp"])} webp, ${sourceCount(["jpg", "jpeg"])} jpg, ${sourceCount(["html"])} html, ${sourceCount(["svg"])} svg, ${sourceCount(["md"])} md, autres ${files.length - sourceCount(["png", "webp", "jpg", "jpeg", "html", "svg", "md"])}).`,
    "",
    "## Résultat",
    `- Sections : **${report.roots.size}** (une par dossier racine) + **${report.sections.size}** sous-sections ; notes de section : ${report.notes.section} ; notes d'écran : ${report.notes.screen}`,
    `- Écrans : **${total}** — ${n(report.byKind)} (dont ${report.resources} dans « ${RESOURCES} »)`,
    `- Plateformes : ${n(report.byPlatform)}`,
    `- Statuts : ${n(report.byStatus)}`,
    `- Écriture : ${n(report.byOutcome)}`,
    `- Dates : git ${report.datesFrom.git}, mtime ${report.datesFrom.mtime}`,
    `- Références inlinées dans les maquettes HTML (CSS, JS, images, polices) : ${report.inlined} (dont ${fallbacks} résolues par repli : chemin relatif périmé, retrouvé depuis la racine du dépôt) ; chemins construits par script (imgDepth + 'assets/…', …/NOM.png) inlinés : ${built}`,
    "",
    `## Associations HTML ↔ PNG (${report.paired.length})`,
    "Le PNG n'est pas importé à part : il sert de vignette à la maquette (tag `rendu-png`).",
    ...report.paired.map(([h, p]) => `- \`${h}\` ↔ \`${p}\``),
    "",
    `## Fichiers ignorés (${report.ignored.length})`,
    ...report.ignored.map((i) => `- \`${i.rel}\` — ${i.reason}`),
    "",
    `## Anomalies (${report.anomalies.length})`,
    ...(report.anomalies.length ? report.anomalies.sort().map((a) => `- ${a}`) : ["- aucune"]),
    "",
  ].join("\n");
}

await main();
process.exit(0);
