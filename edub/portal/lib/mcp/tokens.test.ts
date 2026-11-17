import assert from "node:assert/strict";
import test from "node:test";
import { createLimiter, generateSecret, hashSecret, looksLikeSecret, parseScopes, roleOnProject, secretPrefix } from "./tokens.ts";

test("secrets are random, recognisable and hashed", () => {
  const a = generateSecret(), b = generateSecret();
  assert.notEqual(a, b);
  assert.ok(looksLikeSecret(a));
  assert.equal(hashSecret(a).length, 64);
  assert.notEqual(hashSecret(a), hashSecret(b));
  assert.ok(!secretPrefix(a).includes(a.slice(12)));
  assert.ok(!looksLikeSecret("Bearer x"));
  assert.ok(!looksLikeSecret("edd_short"));
});

test("scopes: validation and strongest-duplicate rule", () => {
  assert.deepEqual(parseScopes([{ project: "tamafit", role: "viewer" }, { project: "tamafit", role: "editor" }]), [{ project: "tamafit", role: "editor" }]);
  assert.deepEqual(parseScopes([{ project: "*", role: "viewer" }]), [{ project: "*", role: "viewer" }]);
  for (const bad of [[], null, "*", [{ project: "tamafit", role: "owner" }], [{ project: "../x", role: "viewer" }], [{ project: "Tama", role: "viewer" }], [{ role: "viewer" }], [1]]) {
    assert.equal(parseScopes(bad), null, JSON.stringify(bad));
  }
});

test("role on project: exact slug, wildcard, never above the grant", () => {
  const scopes = [{ project: "tamafit", role: "editor" as const }, { project: "*", role: "viewer" as const }];
  assert.equal(roleOnProject(scopes, "tamafit"), "editor");
  assert.equal(roleOnProject(scopes, "golfn"), "viewer");
  assert.equal(roleOnProject([{ project: "tamafit", role: "editor" }], "golfn"), null);
  assert.equal(roleOnProject([], "tamafit"), null);
  assert.equal(roleOnProject([{ project: "*", role: "viewer" }], "x"), "viewer");
});

test("limiter: sliding window", () => {
  let t = 0;
  const l = createLimiter(3, 1000, () => t);
  assert.ok(l.take("a") && l.take("a") && l.take("a"));
  assert.ok(!l.take("a"));
  assert.ok(l.take("b"));
  t = 1001;
  assert.ok(l.take("a"));
});
