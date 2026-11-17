import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, parseOriginalUri, publicStatus } from "./gate.ts";

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

test("user C (no right): the editor page and the API both look like 404 to them", () => {
  const page = decide({ ...base, path: "/editor", role: null });
  assert.equal(publicStatus(page), 404);
  const api = decide({ ...base, role: null });
  assert.equal(publicStatus(api), 404);
  assert.equal(publicStatus(decide({ ...base, tenant: "f_00" })), 404);
});

test("a known viewer who writes gets a real 403, not a 404", () => {
  const d = decide({ ...base, role: "viewer", method: "POST", origin: ORIGIN });
  assert.equal(publicStatus(d), 403);
});

test("the editor page opens for any member, reads only", () => {
  assert.deepEqual(decide({ ...base, path: "/editor", role: "viewer" }), { allow: true });
  assert.equal(decide({ ...base, path: "/editor", role: "owner", method: "POST", origin: ORIGIN }).allow, false);
  assert.equal(publicStatus(decide({ ...base, path: "/editor", tenant: null })), 404);
});

test("built-in AI relay is admin-only; image search and hosted models are closed for all", () => {
  const ai = { ...base, method: "POST", origin: ORIGIN, path: "/api/ai/stream" };
  assert.deepEqual(decide({ ...ai, role: "owner", admin: true }), { allow: true });
  const guest = decide({ ...ai, role: "editor" });
  assert.equal(guest.allow, false);
  assert.equal(!guest.allow && guest.reason, "ai-admin-only");
  assert.equal(publicStatus(guest), 403);
  for (const path of ["/api/ai/image/search", "/api/ai/hosted/models"]) {
    const d = decide({ ...ai, path, role: "owner", admin: true });
    assert.equal(d.allow, false, path);
    assert.equal(!d.allow && d.reason, "route-disabled-on-edub");
  }
  // reading the model list is part of the AI surface too
  assert.equal(decide({ ...base, path: "/api/ai/models", role: "viewer" }).allow, false);
});
