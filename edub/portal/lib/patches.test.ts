import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root = edub/portal/lib → ../../..
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const md = readFileSync(join(ROOT, "edub", "PATCHES.md"), "utf8");

/** Every backticked repo path in the first column of a PATCHES.md table row. */
function listedPaths(): string[] {
  return [...md.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]!).filter((p) => !p.includes(" "));
}

test("PATCHES.md lists the contract files and the patched upstream files", () => {
  const paths = listedPaths();
  for (const p of [
    "CLAUDE.md",
    ".gitignore",
    "crates/op-host-services/src/hub_auth_client.rs",
    "crates/op-host-services/src/web_canvas_server/online_policy.rs",
    "crates/op-host-web/src/daemon_base.rs",
    "crates/op-host-services/src/web_canvas_server/tenant_store.rs",
  ]) {
    assert.ok(paths.includes(p), `${p} missing from PATCHES.md`);
  }
});

test("every file listed in PATCHES.md still exists (a vanished patched file means a bad upstream merge)", () => {
  const missing = listedPaths().filter((p) => !existsSync(join(ROOT, p)));
  assert.deepEqual(missing, [], `patched/contract files missing: ${missing.join(", ")}`);
});
