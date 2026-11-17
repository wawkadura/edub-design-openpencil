import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, parseOriginalUri } from "./gate.ts";

const T = "f_0123456789abcdef0123456789abcdef";
const ORIGIN = "https://design.edub.fr";
const base = { method: "GET", path: "/api/mcp/document", tenant: T, origin: null, publicOrigin: ORIGIN, role: "editor" as const };

test("parseOriginalUri takes the first tenant parameter, raw", () => {
  assert.deepEqual(parseOriginalUri(`/api/mcp/events?tenant=${T}`), { path: "/api/mcp/events", tenant: T });
  assert.deepEqual(parseOriginalUri(`/api/x?a=1&tenant=${T}&tenant=f_other`), { path: "/api/x", tenant: T });
  assert.deepEqual(parseOriginalUri("/api/x"), { path: "/api/x", tenant: null });
  assert.deepEqual(parseOriginalUri("/api/x?tenant="), { path: "/api/x", tenant: null });
  assert.deepEqual(parseOriginalUri("/api/x?atenant=f_1"), { path: "/api/x", tenant: null });
});

test("an editor may read and write its file from our origin", () => {
  assert.deepEqual(decide(base), { allow: true });
  assert.deepEqual(decide({ ...base, method: "POST", origin: ORIGIN }), { allow: true });
});

test("no access, bad or missing tenant are refused", () => {
  assert.equal(decide({ ...base, role: null }).allow, false);
  assert.equal(decide({ ...base, tenant: null }).allow, false);
  assert.equal(decide({ ...base, tenant: "u_walid" }).allow, false);
  assert.equal(decide({ ...base, tenant: `${T}/../x` }).allow, false);
});

test("writes need our own Origin (CSRF)", () => {
  for (const origin of [null, "https://evil.example", "https://design.edub.fr.evil.example"]) {
    const d = decide({ ...base, method: "POST", origin });
    assert.deepEqual(d, { allow: false, status: 403, reason: "cross-origin-write-forbidden" });
  }
});

test("viewers are read-only", () => {
  assert.equal(decide({ ...base, role: "viewer" }).allow, true);
  assert.equal(decide({ ...base, role: "viewer", method: "POST", origin: ORIGIN }).allow, false);
});

test("sharing, device login and local file routes stay closed even for the owner", () => {
  for (const path of ["/api/share/grant", "/api/auth/login/begin", "/api/file/save"]) {
    assert.equal(decide({ ...base, role: "owner", path, method: "POST", origin: ORIGIN }).allow, false, path);
  }
  assert.equal(decide({ ...base, path: "/pkg/op_host_web.js" }).allow, false);
});
