/**
 * End-to-end authorization + history test against a running DEV portal (impersonation header,
 * never honoured in production) with a stub editor host. Usage:
 *   npm run e2e   (starts both; see package.json)  or set E2E_BASE / E2E_STUB_PORT.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";

const BASE = process.env.E2E_BASE ?? "http://127.0.0.1:3938";
const STUB_PORT = Number(process.env.E2E_STUB_PORT ?? 3199);
const docs = new Map<string, string>();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

const stub = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const tenant = url.searchParams.get("tenant") ?? "";
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (!req.headers.authorization?.startsWith("Bearer edt1.")) return res.writeHead(401).end("{}");
    if (url.pathname === "/api/mcp/document" && req.method === "GET") {
      const d = docs.get(tenant) ?? '{"version":"1.1","children":[]}';
      return res.end(`{"document":${d},"version":1}`);
    }
    if (url.pathname === "/api/mcp/document" && req.method === "POST") {
      docs.set(tenant, JSON.stringify((JSON.parse(body) as { document: unknown }).document));
      return res.end('{"ok":true,"version":2}');
    }
    if (url.pathname === "/api/export/raster") return res.end(JSON.stringify({ ok: true, dataBase64: png.toString("base64") }));
    res.writeHead(404).end("{}");
  });
});
await new Promise<void>((r) => stub.listen(STUB_PORT, "127.0.0.1", r));

type R = { status: number; data: any; headers: Headers };
async function call(user: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<R> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "x-edub-dev-user": user, origin: BASE, ...(body ? { "content-type": "application/json" } : {}), ...extra },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, headers: res.headers };
}
const gate = (user: string, method: string, uri: string, origin = BASE) =>
  fetch(`${BASE}/api/edub/editor-gate`, { headers: { "x-edub-dev-user": user, "x-original-uri": uri, "x-original-method": method, origin } });

const ADMIN = "edub:design,admin", A = "alice:design", B = "bob:design", C = "carol:design", PAT = "patrick:design,tamagofit-team";
const run = Date.now().toString(36);
const s1 = `e2e-p1-${run}`, s2 = `e2e-p2-${run}`;
let passed = 0;
const ok = (name: string) => { passed++; console.log(`  ✓ ${name}`); };

// ── setup (admin) ──
assert.equal((await call(ADMIN, "POST", "/api/edub/projects", { name: "E2E P1", slug: s1 })).status, 201);
assert.equal((await call(ADMIN, "POST", "/api/edub/projects", { name: "E2E P2", slug: s2 })).status, 201);
assert.equal((await call(A, "POST", "/api/edub/projects", { name: "x" })).status, 403);
ok("only admin creates projects");
await call(ADMIN, "POST", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "alice", role: "owner" });
await call(ADMIN, "POST", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "bob", role: "viewer" });
await call(ADMIN, "POST", `/api/edub/projects/${s2}/members`, { kind: "group", principal: "tamagofit-team", role: "editor" });

// ── visibility ──
const names = async (u: string) => ((await call(u, "GET", "/api/edub/projects")).data.projects as { slug: string }[]).map((p) => p.slug).filter((s) => s.endsWith(run));
assert.deepEqual(await names(A), [s1]);
assert.deepEqual(await names(B), [s1]);
assert.deepEqual(await names(C), []);
assert.deepEqual(await names(PAT), [s2]);
assert.deepEqual((await names(ADMIN)).sort(), [s1, s2].sort());
ok("lists: A→P1, B→P1, C→none, group tamagofit-team→P2, admin→all");

// ── C: 404 everywhere, same body as a project that never existed ──
const ghost = await call(C, "GET", `/api/edub/projects/nope-${run}`);
for (const p of ["", "/members", "/activity", "/files", "/folders"]) {
  const r = await call(C, "GET", `/api/edub/projects/${s1}${p}`);
  assert.equal(r.status === 405 ? 404 : r.status, 404, p);
}
assert.deepEqual((await call(C, "GET", `/api/edub/projects/${s1}`)).data, ghost.data);
assert.equal((await call(C, "POST", `/api/edub/projects/${s1}/files`, { name: "x" })).status, 404);
assert.equal((await call(C, "POST", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "carol", role: "owner" })).status, 404);
ok("C gets 404 on P1 (API), identical to a missing project");

// ── A creates a file ──
const created = await call(A, "POST", `/api/edub/projects/${s1}/files`, { name: "Écran test" });
assert.equal(created.status, 201);
const fileId: string = created.data.file.id;
const meta = (await call(A, "GET", `/api/edub/files/${fileId}`)).data;
const tenant: string = meta.file.tenantId;
assert.match(tenant, /^f_[0-9a-f]{32}$/);
assert.equal((await call(C, "GET", `/api/edub/files/${fileId}`)).status, 404);
assert.equal((await call(PAT, "GET", `/api/edub/files/${fileId}`)).status, 404);
assert.equal((await call(B, "GET", `/api/edub/files/${fileId}`)).status, 200);
ok("file visible to A and B, 404 for C and for another project's group");

// ── B viewer: reads, cannot write/share ──
assert.equal((await call(B, "PATCH", `/api/edub/files/${fileId}`, { name: "hack" })).status, 403);
assert.equal((await call(B, "DELETE", `/api/edub/files/${fileId}`)).status, 403);
assert.equal((await call(B, "POST", `/api/edub/projects/${s1}/files`, { name: "x" })).status, 403);
assert.equal((await call(B, "POST", `/api/edub/files/${fileId}/versions`)).status, 403);
assert.equal((await call(B, "POST", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "bob", role: "owner" })).status, 403);
assert.equal((await call(B, "GET", `/api/edub/files/${fileId}/versions`)).status, 200);
assert.equal((await call(B, "GET", `/api/edub/projects/${s1}`)).data.members, undefined);
ok("B (viewer) reads but cannot save, edit, share; member list hidden");

// ── editor gate (what nginx asks for each editor call) ──
const uriApi = `/api/mcp/document?tenant=${tenant}`;
const g = async (u: string, m: string, uri = uriApi, o = BASE) => { const r = await gate(u, m, uri, o); return { status: r.status, reason: r.headers.get("x-edub-gate-reason") }; };
assert.equal((await g(A, "GET")).status, 200);
assert.equal((await g(A, "POST")).status, 200);
assert.equal((await g(B, "GET")).status, 200);
assert.deepEqual(await g(B, "POST"), { status: 403, reason: "read-only-access" });
assert.deepEqual(await g(C, "GET"), { status: 403, reason: "no-access-to-file" });   // nginx → 404
assert.deepEqual(await g(C, "GET", `/editor?tenant=${tenant}`), { status: 403, reason: "no-access-to-file" });
assert.deepEqual(await g(PAT, "GET"), { status: 403, reason: "no-access-to-file" });
assert.equal((await g(A, "GET", `/editor?tenant=${tenant}`)).status, 200);
assert.equal((await g(ADMIN, "POST")).status, 200);
assert.deepEqual(await g(A, "POST", uriApi, "https://evil.example"), { status: 403, reason: "cross-origin-write-forbidden" });
assert.equal((await g("x:other", "GET")).status, 403);
ok("gate: A rw, B ro, C/other-project no-access (→404 via nginx), admin rw, CSRF refused");

// group access to P2
const f2 = await call(ADMIN, "POST", `/api/edub/projects/${s2}/files`, { name: "TamaFit" });
const t2: string = (await call(ADMIN, "GET", `/api/edub/files/${f2.data.file.id}`)).data.file.tenantId;
assert.equal((await g(PAT, "POST", `/api/mcp/document?tenant=${t2}`)).status, 200);
assert.deepEqual(await g(A, "GET", `/api/mcp/document?tenant=${t2}`), { status: 403, reason: "no-access-to-file" });
ok("group tamagofit-team grants editor access to P2 only");

// ── git history: save 3 times, restore version 1 ──
const doc = (n: number) => JSON.stringify({ version: "1.1", children: [{ type: "frame", id: "n1", name: `v${n}`, width: 100, height: 100, children: [] }] });
for (const n of [1, 2, 3]) {
  docs.set(tenant, doc(n));
  const r = await call(A, "POST", `/api/edub/files/${fileId}/versions`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.unchanged, false);
}
const list = (await call(B, "GET", `/api/edub/files/${fileId}/versions`)).data.versions as { sha: string; author: string; message: string }[];
assert.equal(list.length, 4); // creation + 3 saves
assert.ok(list.slice(0, 3).every((v) => v.author === "alice"));
const v1 = list[2]!;
assert.equal((await call(A, "POST", `/api/edub/files/${fileId}/versions`)).data.unchanged, true);
const rest = await call(A, "POST", `/api/edub/files/${fileId}/restore`, { sha: v1.sha });
assert.equal(rest.status, 200, JSON.stringify(rest.data));
assert.equal(docs.get(tenant), doc(1));
assert.equal((await call(B, "POST", `/api/edub/files/${fileId}/restore`, { sha: v1.sha })).status, 403);
assert.equal((await call(C, "POST", `/api/edub/files/${fileId}/restore`, { sha: v1.sha })).status, 404);
assert.equal((await call(A, "POST", `/api/edub/files/${fileId}/restore`, { sha: "--output=x" })).status, 404);
ok("history: 3 saves → 3 versions with author; restore v1 puts v1 back (new commit)");

// ── files: rename, duplicate, trash/restore, folders, thumbnail ──
assert.equal((await call(A, "PATCH", `/api/edub/files/${fileId}`, { name: "Renommé" })).status, 200);
const dup = await call(A, "POST", `/api/edub/files/${fileId}/duplicate`);
assert.equal(dup.status, 201);
const folder = await call(A, "POST", `/api/edub/projects/${s1}/folders`, { name: "Onboarding" });
assert.equal(folder.status, 201);
assert.equal((await call(A, "PATCH", `/api/edub/files/${dup.data.file.id}`, { folderId: folder.data.folder.id })).status, 200);
assert.equal((await call(A, "DELETE", `/api/edub/files/${dup.data.file.id}`)).status, 200);
const trashed = (await call(A, "GET", `/api/edub/projects/${s1}?trash=1`)).data.files as { id: string }[];
assert.ok(trashed.some((f) => f.id === dup.data.file.id));
assert.equal((await call(A, "PATCH", `/api/edub/files/${dup.data.file.id}`, { restore: true })).status, 200);
const th = await fetch(`${BASE}/api/edub/files/${fileId}/thumbnail`, { headers: { "x-edub-dev-user": A } });
assert.equal(th.status, 200);
assert.equal(th.headers.get("content-type"), "image/png");
assert.equal((await fetch(`${BASE}/api/edub/files/${fileId}/thumbnail`, { headers: { "x-edub-dev-user": C } })).status, 404);
ok("rename, duplicate, folder move, trash/restore, thumbnail (404 for C)");

// ── sharing lifecycle + activity ──
assert.equal((await call(A, "POST", `/api/edub/projects/${s1}/members`, { kind: "group", principal: "tamagofit-team", role: "viewer" })).status, 200);
assert.deepEqual(await names(PAT), [s1, s2].sort());
assert.equal((await call(A, "DELETE", `/api/edub/projects/${s1}/members`, { kind: "group", principal: "tamagofit-team" })).status, 200);
assert.deepEqual(await names(PAT), [s2]);
assert.equal((await call(ADMIN, "DELETE", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "nobody" })).status, 404);
assert.equal((await call(A, "POST", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "bad name", role: "viewer" })).status, 400);
assert.equal((await call(ADMIN, "DELETE", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "edub" })).status, 200);
assert.equal((await call(A, "DELETE", `/api/edub/projects/${s1}/members`, { kind: "user", principal: "alice" })).status, 409);
const act = (await call(B, "GET", `/api/edub/projects/${s1}/activity`)).data.activity as { actor: string; action: string }[];
assert.ok(act.some((a) => a.action === "member.set") && act.some((a) => a.action === "file.created"));
assert.equal((await call(C, "GET", `/api/edub/projects/${s1}/activity`)).status, 404);
ok("share/unshare by user and group, last owner protected, activity journal");

// ── no session / no design group ──
const anon = await fetch(`${BASE}/api/edub/projects`);
assert.equal(anon.status, 401);
assert.equal((await call("intrus:tamagofit-team", "GET", "/api/edub/projects")).status, 403);
assert.equal((await call(A, "POST", "/api/edub/projects", { name: "x" }, { origin: "https://evil.example" })).status, 403);
ok("anonymous 401, non-design 403, cross-origin mutation 403");

stub.close();
console.log(`\n${passed} groups of assertions passed`);
