/**
 * Browser test of the gallery (Playwright + system Chrome) against a DEV portal:
 *  - sandbox: an HTML mockup that tries to read the portal cookie / parent / same-origin API gets nothing;
 *  - lightbox: arrows, Esc, browser Back closes it; compare modes render;
 *  - screenshots (desktop + mobile) into E2E_SHOTS (default /tmp/ed1731/shots).
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import sharp from "sharp";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3951";
const SHOTS = process.env.E2E_SHOTS ?? "/tmp/ed1731/shots";
mkdirSync(SHOTS, { recursive: true });
const USER = "edub:design,admin";
const slug = `e2e-ui-${Date.now().toString(36)}`;
const API = `/api/edub/projects/${slug}`;
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(BASE + path, { method, headers: { "x-edub-dev-user": USER, origin: BASE, ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
};
const mock = (title: string, bg: string, accent: string, w = 390, h = 844) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${bg}"/><rect x="24" y="80" width="${w - 48}" height="120" rx="20" fill="${accent}"/><text x="40" y="150" font-size="28" font-family="sans-serif" fill="#fff">${title}</text><rect x="24" y="${h - 140}" width="${w - 48}" height="56" rx="28" fill="${accent}"/></svg>`)).png().toBuffer();
const up = async (file: Buffer, name: string, type: string, fields: Record<string, string>) => {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(file)], name, { type }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const r = await call("POST", `${API}/screens`, fd);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data.screen;
};

assert.equal((await call("POST", "/api/edub/projects", { name: "Galerie démo", slug, emoji: "🖼️" })).status, 201);
const onb = (await call("POST", `${API}/sections`, { name: "Onboarding" })).data.section;
const pay = (await call("POST", `${API}/sections`, { name: "Paywall" })).data.section;
const palette: [string, string][] = [["#14213d", "#fca311"], ["#0b3d2e", "#2ec4b6"], ["#2b193d", "#e0476b"], ["#1b1b2f", "#7c6cff"]];
const shots = [];
for (let i = 0; i < 12; i++) {
  const [bg, ac] = palette[i % 4]!;
  shots.push(await up(await mock(`Écran ${i + 1}`, bg, ac), `ecran-${i + 1}.png`, "image/png", { sectionId: i % 3 ? onb.id : pay.id, platform: i % 2 ? "ios" : "android", status: ["proposé", "validé", "en prod"][i % 3]!, title: `Écran ${i + 1}`, tags: i % 2 ? "home" : "profil", links: i === 0 ? '["ED_1731"]' : "[]" }));
}
// v2 of the first screen (for the comparison): same layout, other accent colour

const v2fd = new FormData();
v2fd.set("file", new File([new Uint8Array(await mock("Écran 1", "#14213d", "#e0476b"))], "v2.png", { type: "image/png" }));
v2fd.set("note", "bouton rose");
assert.equal((await call("POST", `${API}/screens/${shots[0].id}/versions`, v2fd)).status, 201);

const evil = `<!doctype html><html><body style="margin:0;font-family:sans-serif;background:#fff6e5"><h2 style="padding:24px">Maquette HTML</h2><p id="o" style="padding:0 24px">…</p><script>
const r = {};
try { r.cookie = document.cookie; } catch (e) { r.cookie = "ERR:" + e.name; }
try { r.parent = window.parent.document.title; } catch (e) { r.parent = "ERR:" + e.name; }
try { r.storage = String(localStorage.length); } catch (e) { r.storage = "ERR:" + e.name; }
fetch("/api/edub/projects", { credentials: "include" }).then((x) => x.text()).then((t) => { r.fetch = "READ:" + t.slice(0, 30); }).catch((e) => { r.fetch = "ERR:" + e.name; }).finally(() => {
  document.getElementById("o").textContent = JSON.stringify(r);
  console.log("SANDBOX " + JSON.stringify(r));
  parent.postMessage({ sandbox: r }, "*");
});
</script></body></html>`;
const mockup = await up(Buffer.from(evil), "evil.html", "text/html", { sectionId: pay.id, platform: "ios", title: "Maquette HTML (sandbox)" });

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox", "--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-edub-dev-user": USER } });
await ctx.addCookies([{ name: "portal_session", value: "TOP-SECRET", url: BASE }]);
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));

// 1. sandbox inside the detail page iframe
const msgs: unknown[] = [];
await page.exposeFunction("__collect", (m: unknown) => msgs.push(m));
await page.addInitScript(() => window.addEventListener("message", (e) => (window as any).__collect(e.data?.sandbox ?? null)));
await page.goto(`${BASE}/p/${slug}/screens/${mockup.id}`);
await page.waitForFunction(() => true);
await page.waitForTimeout(1500);
const got = msgs.find(Boolean) as Record<string, string> | undefined;
assert.ok(got, "mockup ran its script and reported back");
assert.match(got.cookie ?? "", /^ERR:SecurityError$/, `document.cookie blocked: ${JSON.stringify(got)}`);
assert.match(got.parent ?? "", /^ERR:/, "parent document unreachable");
assert.match(got.storage ?? "", /^ERR:/, "localStorage blocked");
assert.match(got.fetch ?? "", /^ERR:/, "same-origin API unreadable");
assert.ok(!JSON.stringify(got).includes("TOP-SECRET"));
await page.screenshot({ path: `${SHOTS}/detail-mockup-desktop.png` });
console.log("  ✓ sandbox (iframe): cookie, parent, storage and same-origin fetch all blocked", JSON.stringify(got));

// 2. same file opened directly (top-level): the CSP sandbox still gives it an opaque origin
const direct = await ctx.newPage();
const logs: string[] = [];
direct.on("console", (m) => logs.push(m.text()));
await direct.goto(`${BASE}${API}/screens/${mockup.id}/versions/current/file`);
await direct.waitForTimeout(1200);
const line = logs.find((l) => l.startsWith("SANDBOX "));
assert.ok(line, "direct open ran the script");
const d = JSON.parse(line!.slice(8));
assert.match(d.cookie, /^ERR:SecurityError$/);
assert.match(d.fetch, /^ERR:/);
console.log("  ✓ sandbox (direct navigation): cookie + fetch blocked");
await direct.close();

// 3. gallery + lightbox
await page.goto(`${BASE}/p/${slug}/screens`);
await page.waitForSelector(".screen-card");
await page.waitForTimeout(800);
assert.equal(await page.locator(".screen-card").count(), 13);
const broken = await page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>("img.shot")].filter((i) => i.complete && i.naturalWidth === 0).length);
assert.equal(broken, 0, "no broken thumbnails");
await page.screenshot({ path: `${SHOTS}/gallery-desktop.png` });
await page.locator(".shot-btn").first().click();
await page.waitForSelector(".lightbox");
const t0 = await page.locator(".lb-title b").innerText();
await page.keyboard.press("ArrowRight");
assert.notEqual(await page.locator(".lb-title b").innerText(), t0);
await page.keyboard.press("ArrowLeft");
assert.equal(await page.locator(".lb-title b").innerText(), t0);
await page.screenshot({ path: `${SHOTS}/lightbox-desktop.png` });
await page.goBack();
await page.waitForSelector(".lightbox", { state: "detached", timeout: 3000 });
assert.ok(page.url().endsWith("/screens"), "Back closed the lightbox without leaving the gallery");
await page.locator(".shot-btn").first().click();
await page.keyboard.press("Escape");
await page.waitForSelector(".lightbox", { state: "detached", timeout: 3000 });
console.log("  ✓ lightbox: arrows, Esc and browser Back");

// filters through the URL
await page.selectOption('select[aria-label="Plateforme"]', "ios");
await page.waitForURL(/platform=ios/);
await page.waitForTimeout(500);
assert.equal(await page.locator(".screen-card").count(), 7);
console.log("  ✓ platform filter");

// 4. compare (versions of screen 1) — three modes
await page.goto(`${BASE}/p/${slug}/screens/compare?a=${shots[0].id}@1&b=${shots[0].id}@2`);
await page.waitForSelector(".cmp-side img");
await page.screenshot({ path: `${SHOTS}/compare-side-desktop.png` });
await page.getByRole("tab", { name: "Curseur" }).click();
await page.locator(".cmp-range").fill("50");
await page.screenshot({ path: `${SHOTS}/compare-slider-desktop.png` });
await page.getByRole("tab", { name: "Différences" }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/compare-diff-desktop.png` });
console.log("  ✓ compare: side by side, slider, differences");

// 5. detail page of an image screen
await page.goto(`${BASE}/p/${slug}/screens/${shots[0].id}`);
await page.waitForSelector(".viewer-img");
await page.screenshot({ path: `${SHOTS}/detail-desktop.png`, fullPage: true });

// 6. mobile
const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { "x-edub-dev-user": USER } });
const mp = await m.newPage();
await mp.goto(`${BASE}/p/${slug}/screens`);
await mp.waitForSelector(".screen-card");
await mp.waitForTimeout(800);
await mp.screenshot({ path: `${SHOTS}/gallery-mobile.png` });
await mp.locator(".shot-btn").nth(2).click();
await mp.waitForSelector(".lightbox");
const before = await mp.locator(".lb-title b").innerText();
const box = (await mp.locator(".lb-stage").boundingBox())!;
const cdp = await m.newCDPSession(mp);
const touch = (type: string, x: number) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: box.y + box.height / 2 }] });
await touch("touchStart", 300); await touch("touchMove", 200); await touch("touchMove", 100); await touch("touchEnd", 100);
await mp.waitForTimeout(300);
assert.notEqual(await mp.locator(".lb-title b").innerText(), before, "swipe left → next screen");
await mp.screenshot({ path: `${SHOTS}/lightbox-mobile.png` });
await mp.goBack();
await mp.waitForSelector(".lightbox", { state: "detached", timeout: 3000 });
console.log("  ✓ mobile: swipe navigates, back gesture closes the lightbox");
await mp.goto(`${BASE}/p/${slug}/screens/${mockup.id}`);
await mp.waitForSelector("iframe.mockup");
await mp.screenshot({ path: `${SHOTS}/detail-mockup-mobile.png` });
assert.deepEqual(errors, [], "no page errors");
await browser.close();
console.log("\nUI checks passed; screenshots in", SHOTS);
