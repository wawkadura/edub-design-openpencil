/**
 * End-to-end test of the screen gallery API against a running DEV portal (impersonation header,
 * never honoured in production). Same setup as e2e-rights.mts (throwaway DB, EDUB_DESIGN_PROJECTS_DIR
 * under /tmp). Usage: E2E_BASE=http://127.0.0.1:3938 npm run e2e:screens
 */
import assert from "node:assert/strict";
import sharp from "sharp";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3938";
const run = Date.now().toString(36);
const ADMIN = "edub:design,admin", ALICE = "alice:design", BOB = "bob:design", CAROL = "carol:design";
let passed = 0;
const ok = (n: string) => { passed++; console.log(`  ✓ ${n}`); };

type R = { status: number; data: any; headers: Headers; buf: Buffer };
async function call(user: string, method: string, path: string, body?: unknown): Promise<R> {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + path, {
    method,
    headers: { "x-edub-dev-user": user, origin: BASE, ...(body && !isForm ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let data: any = null;
  try { data = JSON.parse(buf.toString("utf8")); } catch { /* binary */ }
  return { status: res.status, data, headers: res.headers, buf };
}
const png = (r: number, g: number, b: number, w = 390, h = 844) => sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } }).png().toBuffer();
const form = (file: Buffer, name: string, type: string, fields: Record<string, string> = {}) => {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(file)], name, { type }));
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const slug = `e2e-gal-${run}`, other = `e2e-gal2-${run}`, API = `/api/edub/projects/${slug}`;
assert.equal((await call(ADMIN, "POST", "/api/edub/projects", { name: "Gal", slug })).status, 201);
assert.equal((await call(ADMIN, "POST", "/api/edub/projects", { name: "Gal2", slug: other })).status, 201);
await call(ADMIN, "POST", `${API}/members`, { kind: "user", principal: "alice", role: "owner" });
await call(ADMIN, "POST", `${API}/members`, { kind: "user", principal: "bob", role: "viewer" });
await call(ADMIN, "POST", `/api/edub/projects/${other}/members`, { kind: "user", principal: "carol", role: "owner" });
await call(BOB, "GET", "/api/edub/projects"); // mirror users (mentions)

// ── sections ──
const sec = await call(ALICE, "POST", `${API}/sections`, { name: "Onboarding" });
assert.equal(sec.status, 201);
const sub = await call(ALICE, "POST", `${API}/sections`, { name: "Étape 1", parentId: sec.data.section.id });
assert.equal(sub.status, 201);
assert.equal((await call(ALICE, "POST", `${API}/sections`, { name: "trop profond", parentId: sub.data.section.id })).status, 400);
const sec2 = await call(ALICE, "POST", `${API}/sections`, { name: "Paywall" });
assert.equal((await call(BOB, "POST", `${API}/sections`, { name: "x" })).status, 403);
await call(ALICE, "PATCH", `${API}/sections/${sec2.data.section.id}`, { move: "up" });
const order = (await call(ALICE, "GET", `${API}/sections`)).data.sections.filter((s: any) => !s.parentId).map((s: any) => s.name);
assert.deepEqual(order, ["Paywall", "Onboarding"]);
ok("sections: nesting one level, reorder, viewer 403");

// ── upload: multipart + base64 + html ──
const red = await png(220, 30, 30);
const up = await call(ALICE, "POST", `${API}/screens`, form(red, "home-v1.png", "image/png", { sectionId: sub.data.section.id, platform: "ios", tags: "home, onboarding", links: JSON.stringify(["ED_1731", "https://github.com/a/b/pull/7"]), description: "Écran **d'accueil** @bob" }));
assert.equal(up.status, 201, JSON.stringify(up.data));
const s = up.data.screen;
assert.equal(s.title, "home v1");
assert.equal(s.platform, "ios");
assert.equal(s.type, "capture");
assert.deepEqual(s.tickets, ["ED_1731"]);
assert.equal(s.currentVersion, 1);
assert.equal(s.links[0].url, "https://dev.edub.fr/?todo=ED_1731");
const b64 = await call(ALICE, "POST", `${API}/screens`, { filename: "droid.png", contentBase64: (await png(20, 120, 220)).toString("base64"), platform: "android", status: "validé", title: "Droid", agent: "design-bot" });
assert.equal(b64.status, 201);
assert.equal(b64.data.screen.authorKind, "agent");
assert.equal(b64.data.screen.status, "validé");
const dataUrl = await call(ALICE, "POST", `${API}/screens`, { filename: "w.png", contentBase64: `data:image/png;base64,${(await png(0, 0, 0, 50, 50)).toString("base64")}`, platform: "web" });
assert.equal(dataUrl.status, 201);
ok("upload multipart + base64 (+ data URL), author agent, tickets extracted");

const html = `<!doctype html><html><body style="background:#0a7"><h1>Maquette</h1><script>document.title='x'</script></body></html>`;
const h = await call(ALICE, "POST", `${API}/screens`, form(Buffer.from(html), "paywall.html", "text/html", { platform: "ios", title: "Paywall HTML" }));
assert.equal(h.status, 201, JSON.stringify(h.data));
assert.equal(h.data.screen.type, "maquette-html");
ok("html mockup accepted");

// bad uploads
assert.equal((await call(ALICE, "POST", `${API}/screens`, form(Buffer.from("just text"), "a.txt", "text/plain"))).status, 415);
assert.equal((await call(ALICE, "POST", `${API}/screens`, form(Buffer.from("<svg onload=alert(1)/>"), "a.svg", "image/svg+xml"))).status, 415);
assert.equal((await call(ALICE, "POST", `${API}/screens`, form(red, "x.png", "image/png", { platform: "palmos" }))).status, 400);
assert.equal((await call(ALICE, "POST", `${API}/screens`, form(red, "x.png", "image/png", { links: JSON.stringify(["javascript:alert(1)"]) }))).status, 400);
assert.equal((await call(ALICE, "POST", `${API}/screens`, form(red, "x.png", "image/png", { sectionId: "00000000-0000-4000-8000-000000000000" }))).status, 400);
ok("rejects text, svg, bad platform, javascript: link, unknown section");

// ── files, thumbnails, headers ──
const f1 = await call(ALICE, "GET", s.fileUrl);
assert.equal(f1.status, 200);
assert.equal(f1.headers.get("content-type"), "image/png");
assert.equal(f1.headers.get("x-content-type-options"), "nosniff");
assert.deepEqual(f1.buf, red);
const t1 = await call(ALICE, "GET", s.thumbUrl);
assert.equal(t1.status, 200);
assert.equal(t1.headers.get("content-type"), "image/webp");
assert.equal((await sharp(t1.buf).metadata()).format, "webp");
assert.ok((await sharp(t1.buf).metadata()).width! <= 480);
ok("image + WebP thumbnail served with nosniff");
const hf = await call(ALICE, "GET", h.data.screen.fileUrl);
assert.match(hf.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts;/);
assert.doesNotMatch(hf.headers.get("content-security-policy") ?? "", /allow-same-origin/);
const ht = await call(ALICE, "GET", h.data.screen.thumbUrl);
assert.equal(ht.status, 200, "html thumbnail via headless Chrome");
assert.equal(ht.headers.get("content-type"), "image/webp");
ok("html served under sandbox CSP; thumbnail rendered by headless Chrome");

// ── versions ──
const blue = await png(30, 30, 220);
const v2 = await call(ALICE, "POST", `${API}/screens/${s.id}/versions`, form(blue, "home-v2.png", "image/png", { note: "nouveau bouton" }));
assert.equal(v2.status, 201);
assert.equal(v2.data.version.n, 2);
assert.deepEqual((await call(ALICE, "GET", `${API}/screens/${s.id}/versions/1/file`)).buf, red);
assert.deepEqual((await call(ALICE, "GET", `${API}/screens/${s.id}/versions/2/file`)).buf, blue);
assert.deepEqual((await call(ALICE, "GET", `${API}/screens/${s.id}/versions/current/file`)).buf, blue);
const detail = await call(ALICE, "GET", `${API}/screens/${s.id}`);
assert.equal(detail.data.versions.length, 2);
assert.equal(detail.data.screen.currentVersion, 2);
assert.equal((await call(ALICE, "GET", `${API}/screens/${s.id}/versions/3/file`)).status, 404);
assert.equal((await call(ALICE, "POST", `${API}/screens/${s.id}/versions`, form(Buffer.from(html), "x.html", "text/html"))).status, 400);
ok("versions: history kept, v1 still served, wrong-type version refused");

// ── rights: viewer / outsider ──
assert.equal((await call(BOB, "GET", `${API}/screens`)).data.total, 4);
assert.equal((await call(BOB, "GET", s.fileUrl)).status, 200);
assert.equal((await call(BOB, "POST", `${API}/screens`, form(red, "x.png", "image/png"))).status, 403);
assert.equal((await call(BOB, "PATCH", `${API}/screens/${s.id}`, { title: "hack" })).status, 403);
assert.equal((await call(BOB, "DELETE", `${API}/screens/${s.id}`)).status, 403);
assert.equal((await call(BOB, "POST", `${API}/screens/${s.id}/versions`, form(red, "x.png", "image/png"))).status, 403);
ok("viewer reads, cannot create / edit / delete / add versions");
const ghost = await call(CAROL, "GET", `${API}/screens/00000000-0000-4000-8000-000000000000`);
for (const p of ["/screens", `/screens/${s.id}`, `/screens/${s.id}/versions/1/file`, `/screens/${s.id}/versions/current/file`, `/screens/${s.id}/versions/1/thumb`, `/screens/${h.data.screen.id}/versions/1/file`, "/sections", `/screens/${s.id}/comments`]) {
  const r = await call(CAROL, "GET", API + p);
  assert.equal(r.status, 404, p);
}
assert.deepEqual((await call(CAROL, "GET", `${API}/screens/${s.id}/versions/1/file`)).data, ghost.data);
assert.equal((await call(CAROL, "POST", `${API}/screens`, form(red, "x.png", "image/png"))).status, 404);
// guessed image URL through ANOTHER project the caller owns
assert.equal((await call(CAROL, "GET", `/api/edub/projects/${other}/screens/${s.id}/versions/1/file`)).status, 404);
assert.equal((await call(ALICE, "GET", `/api/edub/projects/${other}/screens/${s.id}/versions/1/file`)).status, 404);
ok("outsider gets 404 on guessed image URLs (same body as a missing one); no cross-project reads");

// ── filters / search ──
const total = async (q: string) => (await call(ALICE, "GET", `${API}/screens?${q}`)).data.total;
assert.equal(await total("platform=ios"), 2);
assert.equal(await total("platform=android"), 1);
assert.equal(await total("status=validé"), 1);
assert.equal(await total("status=valide"), 1);
assert.equal(await total("tag=home"), 1);
assert.equal(await total("ticket=ED_1731"), 1);
assert.equal(await total("ticket=ED_9999"), 0);
assert.equal(await total("q=accueil"), 1);
assert.equal(await total("q=ED_1731"), 1);
assert.equal(await total(`section=${sec.data.section.id}`), 1, "root section includes its sub-sections");
assert.equal(await total(`section=${sub.data.section.id}`), 1);
assert.equal(await total("section=none"), 3);
assert.equal(await total("q=100%25"), 0, "LIKE wildcards are escaped");
assert.equal((await call(ALICE, "GET", `${API}/screens?sort=title`)).data.screens[0].title, "Droid");
ok("filters: platform, status, tag, ticket, full-text, section (+children), none, sort");

// ── update ──
const upd = await call(ALICE, "PATCH", `${API}/screens/${s.id}`, { status: "en prod", links: ["ED_1729"], tags: ["x"], sectionId: null });
assert.equal(upd.status, 200);
assert.deepEqual(upd.data.screen.tickets, ["ED_1729"]);
assert.equal(await total("ticket=ED_1731"), 0);
assert.equal((await call(ALICE, "PATCH", `${API}/screens/${s.id}`, { status: "nope" })).status, 400);
ok("update recomputes ticket links");

// ── comments ──
const c = await call(BOB, "POST", `${API}/screens/${s.id}/comments`, { body: "Beau boulot @alice @ghost **ok**", pinX: 0.25, pinY: 0.5 });
assert.equal(c.status, 201, JSON.stringify(c.data));
assert.deepEqual(c.data.comment.mentions, ["alice"], "only project members can be mentioned");
assert.equal(c.data.comment.pinX, 0.25);
assert.equal((await call(BOB, "POST", `${API}/screens/${s.id}/comments`, { body: "x", pinX: 3, pinY: 0 })).status, 400);
assert.equal((await call(BOB, "POST", `${API}/screens/${s.id}/comments`, { body: "  " })).status, 400);
assert.equal((await call(CAROL, "POST", `${API}/screens/${s.id}/comments`, { body: "hi" })).status, 404);
assert.equal((await call(ALICE, "DELETE", `${API}/screens/${s.id}/comments/${c.data.comment.id}`)).status, 200, "owner may delete");
const c2 = await call(BOB, "POST", `${API}/screens/${s.id}/comments`, { body: "second" });
assert.equal((await call(ADMIN, "DELETE", `${API}/screens/${s.id}/comments/${c2.data.comment.id}`)).status, 200);
ok("comments: viewer may comment, mentions restricted to members, pins validated, outsider 404");

// ── delete ──
assert.equal((await call(ALICE, "DELETE", `${API}/screens/${b64.data.screen.id}`)).status, 200);
assert.equal((await call(ALICE, "GET", b64.data.screen.fileUrl)).status, 404);
ok("delete removes the screen and its files");

// ── 200 images: pagination + latency ──
const bulk = await call(ADMIN, "POST", "/api/edub/projects", { name: "Bulk", slug: `${slug}-bulk` });
assert.equal(bulk.status, 201);
const BULK = `/api/edub/projects/${slug}-bulk`;
const t0 = Date.now();
let next = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  for (let i = next++; i < 200; i = next++) {
    const r = await call(ADMIN, "POST", `${BULK}/screens`, form(await png(i % 255, (i * 7) % 255, (i * 13) % 255, 390, 844), `s${i}.png`, "image/png", { platform: i % 2 ? "ios" : "android", title: `Écran ${i}` }));
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
}));
console.log(`    200 uploads in ${Date.now() - t0} ms`);
const t1l = Date.now();
const p1 = (await call(ADMIN, "GET", `${BULK}/screens?pageSize=60&page=1`)).data;
const lat = Date.now() - t1l;
assert.equal(p1.total, 200);
assert.equal(p1.screens.length, 60);
assert.equal((await call(ADMIN, "GET", `${BULK}/screens?pageSize=60&page=4`)).data.screens.length, 20);
assert.ok(lat < 1000, `list took ${lat} ms`);
const thumbs = await Promise.all(p1.screens.slice(0, 20).map((x: any) => call(ADMIN, "GET", x.thumbUrl)));
assert.ok(thumbs.every((t) => t.status === 200 && t.buf.length < 20_000), "thumbnails are small");
ok(`200 images: paginated (60/page), list ${lat} ms, thumbnails < 20 kB`);

console.log(`\n${passed} groups passed`);
