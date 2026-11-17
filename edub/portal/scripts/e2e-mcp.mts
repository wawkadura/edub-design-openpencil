/**
 * Integration test of the agent MCP (ED_1732) with the REAL MCP client SDK, the real Rust editor host
 * (spawned on loopback), a throwaway DB (.env.local → ed1732_dev) and projects under /tmp.
 * Usage: npx tsx scripts/e2e-mcp.mts      (needs /home/edub/apps/edub-design/dist/op-host-web-server)
 */
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import http from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import sharp from "sharp";

process.loadEnvFile(new URL("../.env.local", import.meta.url).pathname);
const HOST_PORT = 3132, HUB_PORT = 3139, FRONT = 3138;
process.env.EDUB_DESIGN_EDITOR_URL = `http://127.0.0.1:${HOST_PORT}`;
process.env.EDUB_DESIGN_PUBLIC_ORIGIN = `http://127.0.0.1:${FRONT}`;
mkdirSync("/tmp/ed1732/editor", { recursive: true });
writeFileSync("/tmp/ed1732/hub-auth", "e2e-hub-internal-secret-0123456789abcdef");

const { getDb, schema } = await import("../lib/db/index.ts");
const { verifyEditorToken } = await import("../lib/editor-token.ts");
const { env } = await import("../lib/env.ts");
const { generateSecret, hashSecret, secretPrefix } = await import("../lib/mcp/tokens.ts");
const { handleMcp } = await import("../lib/mcp/server.ts");
const { GET: download } = await import("../app/mcp/dl/route.ts");
const { eq, inArray } = await import("drizzle-orm");

let passed = 0;
const ok = (n: string) => { passed++; console.log(`  ✓ ${n}`); };
const run = Date.now().toString(36);
const TAMA = `e2e-tama-${run}`, GOLF = `e2e-golf-${run}`;

// ── hub (introspection) + front (nginx stand-in: /mcp → handleMcp, /mcp/dl) ──
http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    const c = verifyEditorToken(env.tokenSecret, JSON.parse(b || "{}").token ?? "");
    res.end(JSON.stringify(c ? { active: true, user_id: c.t, username: c.u, scopes: ["mcp:read", "mcp:write"], expires_at_unix: c.e } : { active: false }));
  });
}).listen(HUB_PORT, "127.0.0.1");
http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const url = `http://127.0.0.1:${FRONT}${req.url}`;
  const init: RequestInit = { method: req.method, headers: req.headers as Record<string, string> };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = Buffer.concat(chunks);
  const r = new Request(url, init);
  const out = req.url?.startsWith("/mcp/dl") ? await download(r) : await handleMcp(r);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(FRONT, "127.0.0.1");

const host: ChildProcess = spawn("/home/edub/apps/edub-design/dist/op-host-web-server", ["--serve-web", String(HOST_PORT), "--host", "127.0.0.1", "--online"], {
  cwd: "/home/edub/apps/edub-design/dist",
  stdio: "ignore",
  env: { ...process.env, OPENPENCIL_HUB_BASE_URL: `http://127.0.0.1:${HUB_PORT}`, OPENPENCIL_HUB_INTERNAL_AUTH_FILE: "/tmp/ed1732/hub-auth", OPENPENCIL_ONLINE_DATA_DIR: "/tmp/ed1732/editor", OPENPENCIL_WEB_ALLOWED_ORIGINS: `http://127.0.0.1:${FRONT}` },
});
for (let i = 0; i < 40; i++) { try { await fetch(`http://127.0.0.1:${HOST_PORT}/api/mcp/server`); break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

// Env the lib reads lazily (hub secret is only needed by the real introspect route; not used here).
const db = getDb();
const mk = async (name: string, slug: string) => (await db.insert(schema.projects).values({ slug, name }).returning())[0]!;
const [pTama, pGolf] = [await mk("TamaFit e2e", TAMA), await mk("GolfN e2e", GOLF)];
const mkToken = async (label: string, scopes: { project: string; role: "viewer" | "editor" }[]) => {
  const secret = generateSecret();
  const [row] = await db.insert(schema.mcpTokens).values({ label, prefix: secretPrefix(secret), hash: hashSecret(secret), scopes, createdBy: "e2e" }).returning();
  return { secret, id: row!.id };
};
const editor = await mkToken(`e2e-tama-${run}`, [{ project: TAMA, role: "editor" }]);
const viewer = await mkToken(`e2e-viewer-${run}`, [{ project: TAMA, role: "viewer" }]);
const revoked = await mkToken(`e2e-revoked-${run}`, [{ project: TAMA, role: "editor" }]);
await db.update(schema.mcpTokens).set({ revokedAt: new Date() }).where(eq(schema.mcpTokens.id, revoked.id));

async function connect(secret: string) {
  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${FRONT}/mcp`), { requestInit: { headers: { authorization: `Bearer ${secret}` } } }));
  return client;
}
type Out = { isError?: boolean; content: { type: string; text?: string; data?: string }[] };
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })) as Out;
const data = (r: Out) => JSON.parse(r.content.find((x) => x.type === "text")!.text!);
const png = (r: number, g: number, b: number) => sharp({ create: { width: 390, height: 844, channels: 3, background: { r, g, b } } }).png().toBuffer();

try {
  // ── editor token on TamaFit ──
  const c = await connect(editor.secret);
  const tools = (await c.listTools()).tools.map((t) => t.name);
  for (const t of ["list_projects", "get_project", "list_files", "read_file", "create_file", "batch_design", "design_skeleton", "export_frame", "export_code", "list_sections", "list_screens", "get_screen", "add_screen", "update_screen", "add_html_mockup", "comment_screen", "search"]) assert.ok(tools.includes(t), `tool ${t}`);
  ok(`tools/list exposes ${tools.length} tools`);

  const projects = data(await call(c, "list_projects")).projects;
  assert.deepEqual(projects.map((p: any) => p.slug), [TAMA]);
  assert.equal(projects[0].role, "editor");
  ok("list_projects: only the scoped project (GolfN invisible)");

  for (const [tool, args] of [["get_project", { project: GOLF }], ["list_files", { project: GOLF }], ["list_screens", { project: GOLF }], ["create_file", { project: GOLF, name: "x" }], ["add_screen", { project: GOLF, imageBase64: (await png(1, 2, 3)).toString("base64") }]] as const) {
    const r = await call(c, tool, args as any);
    assert.equal(r.isError, true, tool);
    assert.match(r.content[0]!.text!, /not found/, tool);
  }
  const unknown = await call(c, "get_project", { project: `no-such-${run}` });
  assert.equal(unknown.content[0]!.text!.replace(`no-such-${run}`, "X"), (await call(c, "get_project", { project: GOLF })).content[0]!.text!.replace(GOLF, "X"));
  ok("GolfN: 'not found' on every tool, same wording as a project that does not exist");

  // screens
  const sec = await db.insert(schema.screenSections).values({ projectId: pTama.id, name: "Paywall" }).returning();
  const add = data(await call(c, "add_screen", { project: TAMA, imageBase64: (await png(200, 20, 20)).toString("base64"), title: "Paywall iOS", platform: "ios", section: "Paywall", tickets: ["ED_1234"], tags: ["paywall"] }));
  assert.equal(add.result, "created");
  assert.equal(add.screen.author, `e2e-tama-${run}`);
  assert.equal(add.screen.authorKind, "agent");
  assert.deepEqual(add.screen.tickets, ["ED_1234"]);
  const again = data(await call(c, "add_screen", { project: TAMA, imageBase64: (await png(20, 200, 20)).toString("base64"), title: "Paywall iOS", platform: "ios" }));
  assert.equal(again.result, "new_version");
  assert.equal(again.version, 2);
  ok("add_screen: created, then a new version for the same title");
  void sec;

  const tmp = `/tmp/ed1732-e2e-${run}.png`;
  writeFileSync(tmp, await png(10, 10, 200));
  assert.equal(data(await call(c, "add_screen", { project: TAMA, path: tmp, title: "Depuis un chemin", platform: "android" })).result, "created");
  for (const bad of ["/etc/passwd", "/tmp/../etc/passwd", "/home/ubuntu/.bashrc", "relative.png"]) {
    const r = await call(c, "add_screen", { project: TAMA, path: bad, title: "x" });
    assert.equal(r.isError, true, bad);
  }
  ok("add_screen path: /tmp file accepted, traversal / outside paths refused");

  const html = data(await call(c, "add_html_mockup", { project: TAMA, html: "<!doctype html><h1>Mockup</h1>", title: "Mockup accueil", platform: "web" }));
  assert.equal(html.screen.type, "maquette-html");
  const list = data(await call(c, "list_screens", { project: TAMA, ticket: "ED_1234" }));
  assert.equal(list.total, 1);
  const shot = await call(c, "get_screen", { project: TAMA, screen: add.screen.id });
  assert.ok(shot.content.some((x) => x.type === "image" && x.data), "image content");
  const url = data(await call(c, "get_screen", { project: TAMA, screen: add.screen.id, as: "url" })).image.url as string;
  const dl = await fetch(url);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get("content-type"), "image/png");
  assert.equal((await fetch(url.replace(/s=.{6}/, "s=AAAAAA"))).status, 404);
  assert.equal(data(await call(c, "comment_screen", { project: TAMA, screen: add.screen.id, body: "Contraste à revoir" })).comment.author, `e2e-tama-${run} (agent)`);
  assert.equal(data(await call(c, "update_screen", { project: TAMA, screen: add.screen.id, status: "validé" })).screen.status, "validé");
  const found = data(await call(c, "search", { query: "Paywall" }));
  assert.ok(found.screens.length >= 1);
  ok("list_screens filter, get_screen image + signed url (tampered → 404), comment, update, search");

  // files + design
  const created = data(await call(c, "create_file", { project: TAMA, name: "Onboarding agent" }));
  assert.ok(created.id);
  const summary = data(await call(c, "read_file", { project: TAMA, file: created.id }));
  assert.equal(summary.pages[0].topLevel[0].id, "n1");
  const design = await call(c, "batch_design", { project: TAMA, file: created.id, script: 'I("n1", {type:"text", content:"Bonjour depuis un agent", x:24, y:24, fontSize:24})' });
  assert.notEqual(design.isError, true, JSON.stringify(design));
  assert.match(design.content.at(-1)!.text!, /"saved":true/);
  const live = JSON.stringify(data(await call(c, "read_file", { project: TAMA, file: created.id, format: "json" })));
  assert.match(live, /Bonjour depuis un agent/);
  const hist = data(await call(c, "read_file", { project: TAMA, file: created.id, history: true })).history as { author: string; message: string }[];
  assert.ok(hist.length >= 2, JSON.stringify(hist));
  assert.equal(hist[0]!.author, `agent:e2e-tama-${run}`);
  assert.match(hist[0]!.message, /batch_design/);
  ok("create_file + batch_design → git commits authored by the token");

  const img = await call(c, "export_frame", { project: TAMA, file: created.id, nodeId: "n1" });
  assert.ok(img.content.some((x) => x.type === "image"), JSON.stringify(img).slice(0, 300));
  const code = await call(c, "export_code", { project: TAMA, file: created.id, framework: "html" });
  assert.notEqual(code.isError, true);
  ok("export_frame (image) + export_code");

  const files = data(await call(c, "list_files", { project: TAMA })).files;
  assert.equal(files.length, 1);
  const bad = await call(c, "batch_design", { project: TAMA, file: created.id, script: "I(", filePath: "/etc/passwd" });
  assert.equal(bad.isError, true);
  const act = await db.select().from(schema.activities).where(eq(schema.activities.projectId, pTama.id));
  assert.ok(act.some((a) => a.actor === `agent:e2e-tama-${run}`));
  ok("activity log names the agent; filePath never reaches the editor");

  // ── viewer ──
  const v = await connect(viewer.secret);
  assert.equal(data(await call(v, "list_projects")).projects[0].role, "viewer");
  assert.equal(data(await call(v, "list_screens", { project: TAMA })).total, 3);
  for (const [tool, args] of [
    ["add_screen", { project: TAMA, imageBase64: (await png(1, 1, 1)).toString("base64") }],
    ["add_html_mockup", { project: TAMA, html: "<p>x</p>" }],
    ["update_screen", { project: TAMA, screen: add.screen.id, title: "hack" }],
    ["comment_screen", { project: TAMA, screen: add.screen.id, body: "hi" }],
    ["create_file", { project: TAMA, name: "nope" }],
    ["batch_design", { project: TAMA, file: created.id, script: 'I("n1",{type:"text",content:"x"})' }],
  ] as const) {
    const r = await call(v, tool, args as any);
    assert.equal(r.isError, true, tool);
    assert.match(r.content[0]!.text!, /read-only/, tool);
  }
  assert.equal(data(await call(v, "read_file", { project: TAMA, file: created.id })).pages.length, 1);
  ok("viewer token: reads work, every write refused");

  // ── revoked / unknown / missing ──
  for (const [label, auth] of [["revoked", `Bearer ${revoked.secret}`], ["garbage", "Bearer edd_nope"], ["none", ""]] as const) {
    const r = await fetch(`http://127.0.0.1:${FRONT}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) }, body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' });
    assert.equal(r.status, 401, label);
  }
  await assert.rejects(connect(revoked.secret));
  ok("revoked / unknown / missing token → 401");

  // ── journal + last_used ──
  const [row] = await db.select().from(schema.mcpTokens).where(eq(schema.mcpTokens.id, editor.id));
  assert.ok(row!.lastUsedAt);
  const calls = await db.select().from(schema.mcpCalls).where(eq(schema.mcpCalls.tokenId, editor.id));
  assert.ok(calls.length > 20 && calls.some((x) => x.tool === "batch_design" && x.ok) && calls.some((x) => !x.ok));
  ok(`journal: ${calls.length} calls recorded, last_used_at set`);

  console.log(`\n${passed} groups passed`);
} finally {
  const ids = [editor.id, viewer.id, revoked.id];
  await db.delete(schema.mcpTokens).where(inArray(schema.mcpTokens.id, ids));
  await db.delete(schema.projects).where(inArray(schema.projects.slug, [TAMA, GOLF]));
  host.kill();
  setTimeout(() => process.exit(process.exitCode ?? 0), 200);
}
