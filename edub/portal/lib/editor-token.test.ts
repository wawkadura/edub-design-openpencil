import { test } from "node:test";
import assert from "node:assert/strict";
import { mintEditorToken, secretEquals, verifyEditorToken } from "./editor-token.ts";

const SECRET = "x".repeat(64);
const T = "f_0123456789abcdef0123456789abcdef";

test("a minted token verifies to its file and user", () => {
  const tok = mintEditorToken(SECRET, T, "patrick", 1000, 600);
  assert.deepEqual(verifyEditorToken(SECRET, tok, 1001), { t: T, u: "patrick", e: 1600 });
});

test("expired, tampered or foreign tokens are rejected", () => {
  const tok = mintEditorToken(SECRET, T, "patrick", 1000, 600);
  assert.equal(verifyEditorToken(SECRET, tok, 1600), null);
  assert.equal(verifyEditorToken("y".repeat(64), tok, 1001), null);
  const [p, body, sig] = tok.split(".");
  const forged = Buffer.from(JSON.stringify({ t: "f_ffffffffffffffffffffffffffffffff", u: "patrick", e: 9999 })).toString("base64url");
  assert.equal(verifyEditorToken(SECRET, `${p}.${forged}.${sig}`, 1001), null);
  assert.equal(verifyEditorToken(SECRET, `${p}.${body}`, 1001), null);
  assert.equal(verifyEditorToken(SECRET, "garbage", 1001), null);
});

test("minting refuses a non-file tenant", () => {
  assert.throws(() => mintEditorToken(SECRET, "u_walid", "walid"));
});

test("secretEquals", () => {
  assert.equal(secretEquals("abc", "abc"), true);
  assert.equal(secretEquals("abc", "abd"), false);
  assert.equal(secretEquals("abc", "abcd"), false);
});
