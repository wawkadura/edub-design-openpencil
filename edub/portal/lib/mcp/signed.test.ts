import assert from "node:assert/strict";
import test from "node:test";
import { signDownload, verifyDownload } from "./signed.ts";

const SECRET = "s".repeat(40);

test("signed link: roundtrip, expiry, tampering, wrong secret", () => {
  const target = { t: "screen", p: "tamafit", s: "abc", n: 2 } as const;
  const { k, s } = signDownload(SECRET, target, 600, 1000);
  assert.deepEqual(verifyDownload(SECRET, k, s, 1100), target);
  assert.equal(verifyDownload(SECRET, k, s, 1601), null, "expired");
  assert.equal(verifyDownload(SECRET, k, s.slice(0, -1) + (s.endsWith("A") ? "B" : "A"), 1100), null, "bad sig");
  assert.equal(verifyDownload("x".repeat(40), k, s, 1100), null, "other secret");
  const forged = Buffer.from(JSON.stringify({ ...target, p: "golfn", e: 9e9 })).toString("base64url");
  assert.equal(verifyDownload(SECRET, forged, s, 1100), null, "payload swapped");
  assert.equal(verifyDownload(SECRET, "", "", 1100), null);
});
