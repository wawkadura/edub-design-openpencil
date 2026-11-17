/**
 * ED_1738 — « invité limité » : un compte editor sur UN projet (comme `patrick` sur TamaFit) ne
 * voit, ne lit et n'écrit RIEN d'un autre projet, par aucune porte : pages, API portail, images,
 * vignettes, versions, éditeur (gate + contexte), admin des jetons, MCP, URL signées.
 * Contre un `next dev` (impersonation `x-edub-dev-user`, jamais honorée en production).
 * Même setup que e2e-rights.mts. Usage : E2E_BASE=http://127.0.0.1:3938 npm run e2e:guest
 */
import assert from "node:assert/strict";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createHmac } from "node:crypto";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3938";
const run = Date.now().toString(36);
const ADMIN = "edub:design,admin", GUEST = "patrick:design";
const OPEN = `e2e-open-${run}`, SECRET = `e2e-secret-${run}`, GHOST = `e2e-ghost-${run}`;
let passed = 0;
const ok = (n: string) => { passed++; console.log(`  ✓ ${n}`); };

type R = { status: number; data: any; headers: Headers; text: string };
async function call(user: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<R> {
  const isForm = body instanceof FormData;
  const res = await fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: { ...(user ? { "x-edub-dev-user": user } : {}), origin: BASE, ...(body && !isForm ? { "content-type": "application/json" } : {}), ...extra },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* html / binary */ }
  return { status: res.status, data, headers: res.headers, text };
}
const png = (c: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: c, g: 40, b: 40 } } }).png().toBuffer();
const form = (file: Buffer, name: string, type: string) => { const fd = new FormData(); fd.set("file", new File([new Uint8Array(file)], name, { type })); return fd; };

// ── setup: OPEN (guest = editor), SECRET (guest has nothing), content in both ──
for (const [slug, name] of [[OPEN, "Ouvert"], [SECRET, "Secret"]] as const) assert.equal((await call(ADMIN, "POST", "/api/edub/projects", { name, slug })).status, 201);
await call(ADMIN, "POST", `/api/edub/projects/${OPEN}/members`, { kind: "user", principal: "patrick", role: "editor" });
await call(ADMIN, "GET", "/api/edub/projects");

const mkScreen = async (slug: string, file: Buffer, name: string, type: string) => {
  const r = await call(ADMIN, "POST", `/api/edub/projects/${slug}/screens`, form(file, name, type));
  assert.equal(r.status, 201, r.text);
  return r.data.screen.id as string;
};
const html = Buffer.from("<!doctype html><title>m</title><h1>maquette secrète</h1><script>1</script>");
const secretImg = await mkScreen(SECRET, await png(200), "secret.png", "image/png");
const secretHtml = await mkScreen(SECRET, html, "secret.html", "text/html");
const openImg = await mkScreen(OPEN, await png(30), "open.png", "image/png");
// a 2nd version of the secret image, so version routes exist
const v2 = await call(ADMIN, "POST", `/api/edub/projects/${SECRET}/screens/${secretImg}/versions`, form(await png(210), "secret2.png", "image/png"));
assert.ok([200, 201].includes(v2.status), v2.text);
const comment = await call(ADMIN, "POST", `/api/edub/projects/${SECRET}/screens/${secretImg}/comments`, { body: "note interne" });
const cid: string = comment.data?.comment?.id ?? "00000000-0000-0000-0000-000000000000";
const secretFile = await call(ADMIN, "POST", `/api/edub/projects/${SECRET}/files`, { name: "Plan secret" });
assert.equal(secretFile.status, 201);
const secretFileId: string = secretFile.data.file.id;
const secretTenant: string = (await call(ADMIN, "GET", `/api/edub/files/${secretFileId}`)).data.file.tenantId;
const openFile = await call(GUEST, "POST", `/api/edub/projects/${OPEN}/files`, { name: "Mon fichier" });
assert.equal(openFile.status, 201, "guest (editor) creates a file in OPEN");
const openTenant: string = (await call(GUEST, "GET", `/api/edub/files/${openFile.data.file.id}`)).data.file.tenantId;

// ── 1. what the guest sees ──
const list = ((await call(GUEST, "GET", "/api/edub/projects")).data.projects as { slug: string }[]).map((p) => p.slug).filter((s) => s.endsWith(run));
assert.deepEqual(list, [OPEN]);
const home = await call(GUEST, "GET", "/");
assert.equal(home.status, 200);
assert.ok(home.text.includes("Ouvert") && !home.text.includes("Secret") && !home.text.includes("Plan secret"), "home shows OPEN only");
assert.ok(!home.text.includes("/admin/tokens") && !home.text.includes("Jetons MCP"), "home has no token admin link");
ok("guest sees only OPEN (API list + home page), no token link");

// ── 2. portal pages of SECRET = same 404 as a project that never existed ──
const pageStatus = async (p: string) => (await call(GUEST, "GET", p)).status;
for (const suffix of ["", "/screens", `/screens/${secretImg}`, `/screens/${secretHtml}`, "/screens/compare", "/activity", `/screens/compare?a=${secretImg}&b=${secretHtml}`]) {
  assert.equal(await pageStatus(`/p/${SECRET}${suffix}`), 404, `page ${suffix}`);
  assert.equal(await pageStatus(`/p/${GHOST}${suffix.replace(secretImg, secretHtml)}`), 404);
}
assert.equal(await pageStatus(`/p/${OPEN}`), 200);
assert.equal(await pageStatus(`/p/${OPEN}/screens`), 200);
assert.equal(await pageStatus(`/p/${OPEN}/screens/${openImg}`), 200);
// a screen id of SECRET addressed through OPEN
assert.equal(await pageStatus(`/p/${OPEN}/screens/${secretImg}`), 404);
ok("pages: SECRET project/screens/compare/activity = 404; OPEN = 200; cross-project screen id = 404");

// ── 3. API of SECRET: every verb on every route = 404, body identical to a missing project ──
const A = `/api/edub/projects/${SECRET}`, G = `/api/edub/projects/${GHOST}`;
const routes: [string, string, unknown?][] = [
  ["GET", ""], ["PATCH", "", { name: "x" }], ["DELETE", ""],
  ["GET", "/members"], ["POST", "/members", { kind: "user", principal: "patrick", role: "owner" }], ["DELETE", "/members", { kind: "user", principal: "edub" }],
  ["GET", "/activity"], ["GET", "/files"], ["POST", "/files", { name: "x" }], ["GET", "/folders"], ["POST", "/folders", { name: "x" }],
  ["GET", "/sections"], ["POST", "/sections", { name: "x" }],
  ["GET", "/screens"], ["GET", "/screens?q=secret"], ["GET", "/screens?q=maquette"], ["POST", "/screens", { filename: "a.png", contentBase64: (await png(1)).toString("base64") }],
];
for (const [m, p, b] of routes) {
  const r = await call(GUEST, m, A + p, b);
  const g = await call(GUEST, m, G + p, b);
  // 405 = the route has no such verb (same answer for a project that does not exist): still no leak.
  assert.ok([404, 405].includes(r.status) && r.status === g.status, `${m} ${p} → ${r.status} (missing project: ${g.status})`);
  assert.deepEqual(r.data, g.data, `${m} ${p}: body must equal the missing-project body`);
}
const sc = (sid: string, rest = "") => `${A}/screens/${sid}${rest}`;
for (const sid of [secretImg, secretHtml]) {
  for (const [m, p, b] of [["GET", ""], ["PATCH", "", { title: "x" }], ["DELETE", ""], ["GET", "/versions"], ["POST", "/versions", undefined],
    ["GET", "/versions/1/file"], ["GET", "/versions/current/file"], ["GET", "/versions/1/file?download=1"], ["GET", "/versions/1/thumb"], ["GET", "/versions/2/thumb"],
    ["GET", "/comments"], ["POST", "/comments", { body: "salut" }], ["DELETE", `/comments/${cid}`]] as [string, string, unknown?][]) {
    const r = await call(GUEST, m, sc(sid, p), b);
    assert.ok([404, 405].includes(r.status), `${m} screens/${sid}${p} → ${r.status}`);
    assert.ok(!r.headers.get("content-type")?.startsWith("image/") && !r.headers.get("content-type")?.startsWith("text/html"), "no content leaks");
  }
}
// the same ids through the guest's own project: not found either
for (const p of ["", "/versions/1/file", "/versions/1/thumb", "/versions/current/file", "/comments"]) {
  assert.equal((await call(GUEST, "GET", `/api/edub/projects/${OPEN}/screens/${secretImg}${p}`)).status, 404, `cross-project ${p}`);
}
ok("API: every SECRET route/verb (project, members, files, sections, screens, images, thumbs, versions, comments, search) = 404 with the missing-project body");

// ── 4. path traversal on the image/file routes ──
for (const evil of ["..%2F..%2F..%2Fetc%2Fpasswd", "%2e%2e%2f%2e%2e%2f", "..", "a%00b", "%252e%252e"]) {
  for (const p of [`/api/edub/projects/${OPEN}/screens/${evil}`, `/api/edub/projects/${OPEN}/screens/${openImg}/versions/${evil}/file`, `/api/edub/projects/${OPEN}/screens/${openImg}/versions/${evil}/thumb`, `/api/edub/projects/${evil}/screens`, `/api/edub/files/${evil}`, `/p/${evil}`]) {
    if (evil === ".." && p.endsWith("/p/..")) continue; // the HTTP client itself normalises it to "/"
    const r = await call(GUEST, "GET", p);
    assert.ok([308, 400, 404, 405].includes(r.status), `${p} → ${r.status}`); // 308 = path normalisation only
    assert.ok(!r.text.includes("root:"), "no file content");
  }
}
const own = await call(GUEST, "GET", `/api/edub/projects/${OPEN}/screens/${openImg}/versions/current/file`);
assert.equal(own.status, 200);
assert.equal(own.headers.get("x-content-type-options"), "nosniff");
ok("path traversal in slug / screen id / version / file id → 400/404, own image still 200 + nosniff");

// ── 5. files (design) of SECRET ──
for (const [m, p, b] of [["GET", ""], ["PATCH", "", { name: "x" }], ["DELETE", ""], ["GET", "/versions"], ["POST", "/versions"], ["POST", "/restore", { sha: "a".repeat(40) }], ["POST", "/duplicate"], ["GET", "/thumbnail"]] as [string, string, unknown?][]) {
  assert.ok([404, 405].includes((await call(GUEST, m, `/api/edub/files/${secretFileId}${p}`, b)).status), `${m} files/${p}`);
}
assert.equal((await call(GUEST, "GET", `/api/edub/files/${openFile.data.file.id}`)).status, 200);
ok("design file routes of SECRET = 404");

// ── 6. editor: gate (page + API) and context ──
const gate = async (method: string, uri: string, origin = BASE) => { const r = await fetch(`${BASE}/api/edub/editor-gate`, { headers: { "x-edub-dev-user": GUEST, "x-original-uri": uri, "x-original-method": method, origin } }); return { status: r.status, reason: r.headers.get("x-edub-gate-reason"), token: r.headers.get("x-edub-editor-token") }; };
const notFoundGate = { status: 403, reason: "no-access-to-file", token: null };
for (const [m, u] of [["GET", `/editor?tenant=${secretTenant}`], ["GET", `/api/mcp/document?tenant=${secretTenant}`], ["POST", `/api/mcp/document?tenant=${secretTenant}`], ["GET", `/api/export/raster?tenant=${secretTenant}`], ["GET", `/api/files?tenant=${secretTenant}`]] as const) {
  assert.deepEqual(await gate(m, u), notFoundGate, `${m} ${u}`);
}
// tenant smuggling: first tenant= wins in the gate AND in the host; an own tenant after it must not unlock
assert.deepEqual(await gate("GET", `/api/mcp/document?tenant=${secretTenant}&tenant=${openTenant}`), notFoundGate);
assert.equal((await gate("GET", `/api/mcp/document?tenant=${openTenant}&tenant=${secretTenant}`)).status, 200, "first wins (host does the same)");
assert.equal((await gate("GET", `/api/mcp/document?x=1&tenant=${secretTenant}`)).status, 403);
// no tenant / bad tenant / dot-dot / closed routes
for (const u of ["/api/mcp/document", "/api/mcp/document?tenant=", "/api/mcp/document?tenant=f_xyz", `/api/mcp/document?tenant=${openTenant}%00`, `/api/../etc/passwd?tenant=${openTenant}`, "/editor"]) assert.equal((await gate("GET", u)).status, 403, u);
for (const p of ["/api/share/x", "/api/auth/device", "/api/file/x", "/api/ai/image/search", "/api/ai/hosted/x"]) assert.equal((await gate("GET", `${p}?tenant=${openTenant}`)).reason, "route-disabled-on-edub", p);
assert.equal((await gate("POST", `/api/ai/chat?tenant=${openTenant}`)).reason, "ai-admin-only", "no built-in AI for the guest");
assert.equal((await gate("POST", `/api/mcp/document?tenant=${openTenant}`)).status, 200, "guest edits OPEN");
assert.equal((await gate("GET", `/editor?tenant=${openTenant}`)).status, 200);
assert.equal((await gate("POST", `/api/mcp/document?tenant=${openTenant}`, "https://evil.example")).reason, "cross-origin-write-forbidden");
assert.equal((await call(GUEST, "GET", `/api/edub/editor-context?tenant=${secretTenant}`)).status, 404);
const ctx = (await call(GUEST, "GET", `/api/edub/editor-context?tenant=${openTenant}`)).data;
assert.deepEqual([ctx.role, ctx.canWrite, ctx.ai], ["editor", true, false]);
ok("editor: SECRET tenant refused on page + API (smuggling, CORS write, closed routes), OPEN editable, no AI, context 404/editor");

// ── 7. admin + creation ──
for (const [m, p, b] of [["GET", "/api/edub/admin/tokens"], ["POST", "/api/edub/admin/tokens", { label: "x", scopes: [{ project: "*", role: "editor" }] }], ["DELETE", "/api/edub/admin/tokens/00000000-0000-0000-0000-000000000000"]] as [string, string, unknown?][]) {
  assert.equal((await call(GUEST, m, p, b)).status, 404, `${m} ${p}`);
}
assert.equal((await call(GUEST, "GET", "/admin/tokens")).status, 404);
assert.equal((await call(GUEST, "POST", "/api/edub/projects", { name: "pirate" })).status, 403);
assert.equal((await call(GUEST, "POST", `/api/edub/projects/${OPEN}/members`, { kind: "user", principal: "patrick", role: "owner" })).status, 403, "editor cannot share / promote himself");
assert.equal((await call(GUEST, "PATCH", `/api/edub/projects/${OPEN}`, { name: "renamed" })).status, 403);
assert.equal((await call(null, "GET", "/api/edub/projects")).status, 401);
assert.equal((await call("intrus:tamagofit-team", "GET", `/api/edub/projects/${OPEN}`)).status, 403);
ok("no token admin (API + page 404), cannot create/share/rename, anonymous 401, non-design 403");

// ── 8. MCP: a token scoped to OPEN only (what Patrick's agent would get) ──
const mk = await call(ADMIN, "POST", "/api/edub/admin/tokens", { label: `e2e-${run}`, scopes: [{ project: OPEN, role: "editor" }] });
assert.equal(mk.status, 201, mk.text);
const secret: string = mk.data.secret, tokenId: string = mk.data.token.id;
assert.match(secret, /^edd_/);
const mcp = new Client({ name: "e2e-guest", version: "1" });
await mcp.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }));
const tool = async (name: string, args: Record<string, unknown>) => { const r: any = await mcp.callTool({ name, arguments: args }); return { err: r.isError === true, text: r.content.map((c: any) => c.text ?? "").join("\n") }; };
const seen = JSON.parse((await tool("list_projects", {})).text);
assert.deepEqual((seen.projects ?? seen).map((p: any) => p.slug).filter((s: string) => s.endsWith(run)), [OPEN]);
const missing = await tool("get_project", { project: GHOST });
for (const [name, args] of [
  ["get_project", { project: SECRET }], ["list_files", { project: SECRET }], ["list_sections", { project: SECRET }], ["list_screens", { project: SECRET }],
  ["get_screen", { project: SECRET, screen: secretImg }], ["get_screen", { project: OPEN, screen: secretImg }],
  ["add_screen", { project: SECRET, title: "x", imageBase64: (await png(5)).toString("base64") }], ["add_html_mockup", { project: SECRET, title: "x", html: "<h1>x</h1>" }],
  ["create_file", { project: SECRET, name: "x" }], ["read_file", { project: SECRET, file: secretFileId }], ["read_file", { project: OPEN, file: secretFileId }],
  ["batch_get", { project: SECRET, file: secretFileId }], ["export_frame", { project: OPEN, file: secretFileId, nodeId: "n1" }],
  ["comment_screen", { project: SECRET, screen: secretImg, body: "x" }], ["update_screen", { project: SECRET, screen: secretImg, title: "x" }],
] as [string, Record<string, unknown>][]) {
  const r = await tool(name, args);
  assert.ok(r.err, `${name} must fail: ${r.text.slice(0, 120)}`);
  assert.ok(!/secret|maquette|note interne/i.test(r.text.replace(new RegExp(SECRET, "g"), "").replace(/secretImg/g, "")) || /not found/.test(r.text), `${name} leaks: ${r.text.slice(0, 200)}`);
}
const q = JSON.parse((await tool("search", { query: "secret" })).text);
assert.equal(q.screens.length + q.files.length, 0, "search must not cross projects");
assert.ok(missing.err && /not found/.test(missing.text));
// own project works: add a screen
const added = await tool("add_screen", { project: OPEN, title: "Agent screen", platform: "ios", imageBase64: (await png(90)).toString("base64") });
assert.ok(!added.err, added.text);
await mcp.close();
// no token / forged / revoked
const rpc = (auth?: string) => fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
assert.equal((await rpc()).status, 401);
assert.equal((await rpc("Bearer edd_" + "A".repeat(43))).status, 401);
assert.equal((await rpc(`Bearer ${secret}`)).status, 200);
assert.equal((await call(ADMIN, "DELETE", `/api/edub/admin/tokens/${tokenId}`)).status, 200);
assert.equal((await rpc(`Bearer ${secret}`)).status, 401, "revoked token refused");
ok("MCP: OPEN-only token sees/edits OPEN, every SECRET tool = not found, search closed, no/forged/revoked token 401");

// ── 9. signed links: forged, tampered, expired ──
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const k = b64({ t: "screen", p: SECRET, s: secretImg, n: 1, e: Math.floor(Date.now() / 1000) + 600 });
for (const sig of ["", "x", createHmac("sha256", "guess").update(`dl1.${k}`).digest("base64url")]) assert.equal((await call(null, "GET", `/mcp/dl?k=${k}&s=${sig}`)).status, 404);
assert.equal((await call(null, "GET", "/mcp/dl")).status, 404);
ok("signed download links: missing / forged signature = 404");

console.log(`\n${passed} groups of assertions passed`);
