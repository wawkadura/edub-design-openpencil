import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { chromium, type Browser } from "playwright-core";
import { env } from "./env.ts";
import { HttpError } from "./projects.ts";
import { imageFormat, looksLikeHtml, MAX_HTML_BYTES, MAX_IMAGE_BYTES, type Detected } from "./screens-model.ts";

/**
 * Disk side of the gallery: `<projectsDir>/<slug>/screens/<screenId>/v<n>.<ext>` + `v<n>.thumb.webp`.
 * Paths are rebuilt from validated pieces only (uuid, int, fixed extension): nothing user-controlled
 * ever reaches the filesystem.
 */
export const THUMB_WIDTH = 480;
const UUID = /^[0-9a-f-]{36}$/;

export function screenDir(slug: string, screenId: string): string {
  if (!UUID.test(screenId) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) throw new Error("bad screen path");
  return path.join(env.projectsDir, slug, "screens", screenId);
}
export const versionPath = (slug: string, screenId: string, n: number, ext: string) => path.join(screenDir(slug, screenId), `v${Math.trunc(n)}.${ext.replace(/[^a-z0-9]/g, "")}`);
export const thumbPath = (slug: string, screenId: string, n: number) => path.join(screenDir(slug, screenId), `v${Math.trunc(n)}.thumb.webp`);

export type Stored = { detected: Detected; width: number | null; height: number | null; bytes: number; sha256: string; data: Buffer };

/** Identify the upload from its CONTENT (never from the claimed mime): raster image or HTML. */
export async function inspectUpload(filename: string, claimedMime: string | undefined, data: Buffer): Promise<Stored> {
  if (data.length === 0) throw new HttpError(400, "fichier vide");
  const sha256 = createHash("sha256").update(data).digest("hex");
  const head = data.subarray(0, 512).toString("utf8");
  try {
    const meta = await sharp(data, { limitInputPixels: 120_000_000 }).metadata();
    const fmt = imageFormat(meta.format);
    if (fmt) {
      if (data.length > MAX_IMAGE_BYTES) throw new HttpError(413, "image trop grosse (25 Mo max)");
      return { detected: { kind: "image", ...fmt }, width: meta.width ?? null, height: meta.pageHeight ?? meta.height ?? null, bytes: data.length, sha256, data };
    }
  } catch (e) {
    if (e instanceof HttpError) throw e;
    /* not a raster image: maybe HTML */
  }
  if (looksLikeHtml(filename, claimedMime, head) && !data.subarray(0, 16).includes(0)) {
    if (data.length > MAX_HTML_BYTES) throw new HttpError(413, "maquette trop grosse (8 Mo max)");
    return { detected: { kind: "html", mime: "text/html", ext: "html" }, width: null, height: null, bytes: data.length, sha256, data };
  }
  throw new HttpError(415, "format non pris en charge (png, jpg, webp, gif, avif ou html)");
}

export async function writeVersionFile(slug: string, screenId: string, n: number, s: Stored): Promise<void> {
  await mkdir(screenDir(slug, screenId), { recursive: true });
  await writeFile(versionPath(slug, screenId, n, s.detected.ext), s.data);
}

export const readVersionFile = (slug: string, screenId: string, n: number, ext: string) => readFile(versionPath(slug, screenId, n, ext));
export const removeScreenFiles = (slug: string, screenId: string) => rm(screenDir(slug, screenId), { recursive: true, force: true });

/* ───────── thumbnails ───────── */

export async function imageThumb(data: Buffer): Promise<Buffer> {
  return sharp(data, { limitInputPixels: 120_000_000 }).rotate().resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
}

let browser: Promise<Browser> | null = null;
let idleTimer: NodeJS.Timeout | null = null;
let running = 0;
const waiters: (() => void)[] = [];
const MAX_PARALLEL = 2;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = chromium.launch({ executablePath: process.env.EDUB_DESIGN_CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] });
    browser.then((b) => b.on("disconnected", () => (browser = null))).catch(() => (browser = null));
  }
  return browser;
}

/**
 * HTML mockup → WebP thumbnail with headless Chrome: JavaScript OFF and every network request
 * aborted (the page is untrusted), phone-sized viewport, top of the page only.
 */
export async function htmlThumb(html: Buffer): Promise<Buffer> {
  if (running >= MAX_PARALLEL) await new Promise<void>((r) => waiters.push(r));
  running++;
  if (idleTimer) clearTimeout(idleTimer);
  try {
    const b = await getBrowser();
    const ctx = await b.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    try {
      await ctx.route("**/*", (route) => (route.request().url().startsWith("data:") ? route.continue() : route.abort()));
      const page = await ctx.newPage();
      await page.setContent(html.toString("utf8"), { waitUntil: "load", timeout: 8000 });
      const png = await page.screenshot({ type: "png", timeout: 8000 });
      return await sharp(png).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
    } finally {
      await ctx.close().catch(() => {});
    }
  } finally {
    running--;
    waiters.shift()?.();
    if (running === 0) idleTimer = setTimeout(() => void browser?.then((b) => b.close()).catch(() => {}).finally(() => (browser = null)), 30_000);
  }
}

/** Best effort: a failed thumbnail never fails the upload (the UI shows a placeholder, GET retries). */
export async function makeThumb(slug: string, screenId: string, n: number, kind: "image" | "html", data: Buffer): Promise<boolean> {
  try {
    const webp = kind === "image" ? await imageThumb(data) : await htmlThumb(data);
    await writeFile(thumbPath(slug, screenId, n), webp);
    return true;
  } catch (e) {
    console.error("screen thumbnail failed", screenId, n, e instanceof Error ? e.message : e);
    return false;
  }
}
