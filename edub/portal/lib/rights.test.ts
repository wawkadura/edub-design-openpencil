import assert from "node:assert/strict";
import { test } from "node:test";
import { canManage, canWrite, parsePrincipal, resolveRole, slugify, type MemberGrant } from "./rights.ts";

const P1: MemberGrant[] = [
  { principalKind: "user", principal: "alice", role: "owner" },
  { principalKind: "user", principal: "bob", role: "viewer" },
];
const P2: MemberGrant[] = [{ principalKind: "group", principal: "tamagofit-team", role: "editor" }];
const who = (username: string, ...groups: string[]) => ({ username, groups: ["design", ...groups] });

test("A owner of P1, B viewer of P1, C no right", () => {
  assert.equal(resolveRole(who("alice"), P1), "owner");
  assert.equal(resolveRole(who("bob"), P1), "viewer");
  assert.equal(resolveRole(who("carol"), P1), null);
});

test("viewer reads but cannot write or manage", () => {
  const r = resolveRole(who("bob"), P1);
  assert.equal(canWrite(r), false);
  assert.equal(canManage(r), false);
  assert.equal(canWrite("editor"), true);
  assert.equal(canManage("editor"), false);
  assert.equal(canManage("owner"), true);
  assert.equal(canWrite(null), false);
});

test("group tamagofit-team gives access to P2 only", () => {
  assert.equal(resolveRole(who("patrick", "tamagofit-team"), P2), "editor");
  assert.equal(resolveRole(who("patrick", "tamagofit-team"), P1), null);
  assert.equal(resolveRole(who("patrick"), P2), null);
});

test("strongest role wins across user and group rows", () => {
  const members: MemberGrant[] = [
    { principalKind: "user", principal: "dan", role: "viewer" },
    { principalKind: "group", principal: "tamagofit-team", role: "editor" },
  ];
  assert.equal(resolveRole(who("dan", "tamagofit-team"), members), "editor");
});

test("a user row never matches a group of the same name, and vice versa", () => {
  const members: MemberGrant[] = [{ principalKind: "user", principal: "tamagofit-team", role: "owner" }];
  assert.equal(resolveRole(who("x", "tamagofit-team"), members), null);
  const g: MemberGrant[] = [{ principalKind: "group", principal: "alice", role: "owner" }];
  assert.equal(resolveRole(who("alice"), g), null);
});

test("admin group is owner of everything, even without membership", () => {
  assert.equal(resolveRole(who("edub", "admin"), []), "owner");
  assert.equal(resolveRole(who("edub", "admin"), P1), "owner");
});

test("principal parsing and slugs", () => {
  assert.equal(parsePrincipal("  Patrick "), "patrick");
  assert.equal(parsePrincipal("a b"), null);
  assert.equal(parsePrincipal(""), null);
  assert.equal(parsePrincipal(42), null);
  assert.equal(slugify("Edub Games — Été"), "edub-games-ete");
});
