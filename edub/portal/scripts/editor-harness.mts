// DEV/QA harness (ED_1730): mimics nginx + gate + hub on loopback so the real Rust editor can be driven
// without an Authelia account. Not deployed. Usage: npx tsx scripts/editor-harness.mts
//   http://127.0.0.1:3938/editor?tenant=f_<32hex>&as=viewer|editor|admin
import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mintEditorToken, verifyEditorToken } from "../lib/editor-token.ts";
import { decide, parseOriginalUri } from "../lib/gate.ts";

const FRONT = Number(process.env.HARNESS_PORT ?? 3938), HUB = FRONT + 1, EDITOR = FRONT + 163;
const SECRET = "harness-token-secret";
const DIST = "/home/edub/apps/edub-design/dist";
const TENANT = "f_0123456789abcdef0123456789abcdef";
const ORIGIN = `http://127.0.0.1:${FRONT}`;
const PUBLIC = new URL("../public/", import.meta.url).pathname;
mkdirSync("/tmp/ed1730/data", { recursive: true });
writeFileSync("/tmp/ed1730/hub-auth", "harness-internal");
const log: string[] = [];

// sub_filter rules come straight from the nginx conf so the harness cannot drift from it.
const conf = readFileSync(new URL("../../deploy/nginx-design.edub.fr.conf", import.meta.url), "utf8");
const subs = [...conf.matchAll(/^\s*sub_filter '([^']+)' '([^']+)';$/gm)].map((m) => [m[1], m[2]] as const);
const editorCsp = /location = \/editor \{[\s\S]*?add_header Content-Security-Policy "([^"]+)"/.exec(conf)?.[1] ?? "";

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.headers["x-op-internal-auth"] !== "harness-internal") { res.writeHead(401).end(); return; }
    const claims = verifyEditorToken(SECRET, JSON.parse(body || "{}").token ?? "");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(claims ? { active: true, user_id: claims.t, username: claims.u, scopes: ["mcp:read", "mcp:write"], expires_at_unix: claims.e } : { active: false }));
  });
}).listen(HUB, "127.0.0.1");

spawn(`${DIST}/op-host-web-server`, ["--serve-web", String(EDITOR), "--host", "127.0.0.1", "--online"], {
  cwd: DIST, stdio: "inherit",
  env: { ...process.env, OPENPENCIL_HUB_BASE_URL: `http://127.0.0.1:${HUB}`, OPENPENCIL_HUB_INTERNAL_AUTH_FILE: "/tmp/ed1730/hub-auth", OPENPENCIL_ONLINE_DATA_DIR: "/tmp/ed1730/data", OPENPENCIL_WEB_ALLOWED_ORIGINS: ORIGIN },
});

const roleOf = (as: string) => (as === "viewer" ? "viewer" : as === "admin" ? "owner" : "editor") as "viewer" | "editor" | "owner";
const ctxFor = (as: string) => ({
  ok: true, role: roleOf(as), canWrite: as !== "viewer", ai: as === "admin", user: as,
  project: { slug: "tamagofit", name: "TamaFit", emoji: "🐣" }, folders: [{ id: "d1", name: "Onboarding" }],
  file: { id: "0b1c2d3e-0000-4000-8000-000000000001", name: "Accueil v2" }, links: { library: "/p/tamagofit", home: "/" },
});

function proxy(req: http.IncomingMessage, res: http.ServerResponse, path: string, headers: Record<string, string> = {}, transform?: (b: string) => string) {
  const h = { ...req.headers, ...headers, host: `127.0.0.1:${EDITOR}`, "accept-encoding": "identity" } as Record<string, string>;
  delete h.cookie;
  const up = http.request({ host: "127.0.0.1", port: EDITOR, path, method: req.method, headers: h }, (r) => {
    if (transform) {
      let b = ""; r.setEncoding("utf8"); r.on("data", (c) => (b += c));
      r.on("end", () => { const o = transform(b); const hh = { ...r.headers, "content-length": String(Buffer.byteLength(o)) } as Record<string, string>; res.writeHead(r.statusCode ?? 502, hh).end(o); });
    } else { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); }
  });
  up.on("error", () => res.writeHead(502).end());
  req.pipe(up);
}

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  const as = url.searchParams.get("as") ?? /(?:^|; )as=(\w+)/.exec(req.headers.cookie ?? "")?.[1] ?? "editor";
  if (url.searchParams.get("as")) res.setHeader("set-cookie", `as=${as}; Path=/`);
  const p = url.pathname;
  log.push(`${req.method} ${p}`);
  if (p === "/__log") { res.end(log.join("\n")); return; }
  if (p === "/api/edub/editor-context") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(ctxFor(as))); return; }
  const J = (o: unknown, c = 200) => res.writeHead(c, { "content-type": "application/json" }).end(JSON.stringify(o));
  if (p === "/api/edub/projects") { J({ ok: true, projects: [{ slug: "tamagofit", name: "TamaFit", emoji: "🐣", role: roleOf(as), fileCount: 2 }, { slug: "golfn", name: "GolfN", emoji: null, role: "viewer", fileCount: 1 }] }); return; }
  if (p === "/api/edub/projects/tamagofit") { J({ ok: true, folders: [{ id: "d1", name: "Onboarding" }], files: [{ id: "a", tenantId: TENANT, name: "Accueil v2", screenCount: 3 }] }); return; }
  if (/^\/api\/edub\/files\/[^/]+\/versions$/.test(p)) { log.push("VERSION-SAVED"); J({ ok: true, sha: "abc" }, 200); return; }
  if (p.startsWith("/api/edub/projects/") && p.endsWith("/files")) { res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, file: { id: "x", name: "copie" } })); return; }
  if (["/edub-shell.js", "/favicon.ico", "/favicon-32.png", "/apple-touch-icon.png", "/sw.js", "/icon.svg"].includes(p)) {
    res.writeHead(200, { "content-type": p.endsWith(".js") ? "text/javascript" : p.endsWith(".svg") ? "image/svg+xml" : "image/png" }).end(readFileSync(PUBLIC + p.slice(1))); return;
  }
  if (p === "/manifest.webmanifest") { res.writeHead(200, { "content-type": "application/manifest+json" }).end("{}"); return; }
  if (p === "/editor") {
    const tenant = url.searchParams.get("tenant");
    if (tenant !== TENANT) { res.writeHead(404).end("not found"); return; }
    res.setHeader("content-security-policy", editorCsp);
    proxy(req, res, "/", {}, (b) => subs.reduce((acc, [from, to]) => acc.replace(from, to), b)); return;
  }
  if (p.startsWith("/pkg/") || p.startsWith("/canvaskit/")) { proxy(req, res, p + url.search); return; }
  if (p.startsWith("/api/")) {
    const { path, tenant } = parseOriginalUri(req.url ?? "");
    const d = decide({ method: req.method ?? "GET", path, tenant, origin: (req.headers.origin as string) ?? null, publicOrigin: ORIGIN, role: tenant === TENANT ? roleOf(as) : null, admin: as === "admin" });
    if (!d.allow) { res.writeHead(d.reason === "no-access-to-file" ? 404 : d.status, { "content-type": "application/json", "x-edub-gate-reason": d.reason }).end(JSON.stringify({ ok: false, reason: d.reason })); return; }
    proxy(req, res, req.url ?? "/", { authorization: `Bearer ${mintEditorToken(SECRET, tenant as string, as)}` }); return;
  }
  res.writeHead(404).end("harness: not found");
}).listen(FRONT, "127.0.0.1", () => console.log(`harness on ${ORIGIN}/editor?tenant=${TENANT}&as=editor`));
