import { test } from "node:test";
import assert from "node:assert/strict";
import { canUseDesign, identityFromHeaders, isAdmin, parseDevUser } from "./identity.ts";

const h = (o: Record<string, string>) => new Headers(o);

test("production reads Remote-* and ignores EDUB_DESIGN_DEV_USER", () => {
  const id = identityFromHeaders(h({ "remote-user": "patrick", "remote-groups": "tamagofit-team,design" }), {
    production: true,
    devUser: "edub:admin",
  });
  assert.equal(id?.username, "patrick");
  assert.deepEqual(id?.groups, ["tamagofit-team", "design"]);
  assert.equal(id?.impersonated, false);
  assert.equal(identityFromHeaders(h({}), { production: true, devUser: "edub:admin" }), null);
});

test("dev impersonation", () => {
  const id = identityFromHeaders(h({ "remote-user": "someone" }), { production: false, devUser: "patrick:design" });
  assert.equal(id?.username, "patrick");
  assert.equal(id?.impersonated, true);
  assert.deepEqual(parseDevUser("bob")?.groups, ["design"]);
  assert.equal(parseDevUser("bad user"), null);
});

test("group checks", () => {
  assert.equal(canUseDesign({ groups: ["design"] }), true);
  assert.equal(canUseDesign({ groups: ["admin"] }), true);
  assert.equal(canUseDesign({ groups: ["tamagofit-team"] }), false);
  assert.equal(isAdmin({ groups: ["design"] }), false);
});
