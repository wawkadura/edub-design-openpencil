import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { authorFor, commitFile, listVersions, readVersion } from "./versioning.ts";

const root = mkdtempSync(path.join(tmpdir(), "edub-versioning-"));
after(() => rmSync(root, { recursive: true, force: true }));
const F1 = "11111111-1111-1111-1111-111111111111";
const F2 = "22222222-2222-2222-2222-222222222222";

test("3 saves → 3 versions with authors; restoring v1 returns the first content", async () => {
  const a = authorFor("alice");
  const s1 = await commitFile(root, "p1", F1, '{"v":1}', a, "version 1");
  const s2 = await commitFile(root, "p1", F1, '{"v":2}', authorFor("bob"), "version 2");
  const s3 = await commitFile(root, "p1", F1, '{"v":3}', a, "version 3");
  assert.ok(s1 && s2 && s3);
  const versions = await listVersions(root, "p1", F1);
  assert.deepEqual(versions.map((v) => v.message), ["version 3", "version 2", "version 1"]);
  assert.deepEqual(versions.map((v) => v.author), ["alice", "bob", "alice"]);
  assert.equal(await readVersion(root, "p1", F1, s1), '{"v":1}');
  assert.equal(await readVersion(root, "p1", F1, s2.slice(0, 8)), '{"v":2}');
});

test("an unchanged save makes no commit", async () => {
  assert.equal(await commitFile(root, "p1", F1, '{"v":3}', authorFor("alice"), "same"), null);
  assert.equal((await listVersions(root, "p1", F1)).length, 3);
});

test("a version of another file is refused; bad ids rejected", async () => {
  const other = await commitFile(root, "p1", F2, '{"other":true}', authorFor("alice"), "f2");
  assert.ok(other);
  await assert.rejects(readVersion(root, "p1", F1, other), /version not found/);
  await assert.rejects(readVersion(root, "p1", F1, "--output=x"), /invalid version/);
  await assert.rejects(commitFile(root, "../x", F1, "{}", authorFor("a"), "m"), /invalid project slug/);
  assert.deepEqual(await listVersions(root, "never", F1), []);
});

test("concurrent saves are serialised", async () => {
  const f3 = "33333333-3333-3333-3333-333333333333";
  const out = await Promise.all([1, 2, 3, 4].map((i) => commitFile(root, "p2", f3, `{"i":${i}}`, authorFor("a"), `m${i}`)));
  assert.equal(out.filter(Boolean).length, 4);
  assert.equal((await listVersions(root, "p2", f3)).length, 4);
});
