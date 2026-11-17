import assert from "node:assert/strict";
import { test } from "node:test";
import { SEED_PROJECTS } from "../scripts/seed-projects.ts";
import { SLUG_RE } from "./rights.ts";

test("seed projects: valid slugs, colours, unique, GolfN empty", () => {
  const slugs = SEED_PROJECTS.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const p of SEED_PROJECTS) {
    assert.match(p.slug, SLUG_RE);
    assert.match(p.color, /^#[0-9a-f]{6}$/i);
    assert.ok(p.emoji.length <= 8 && p.name.length <= 80 && p.description.length <= 500);
  }
  assert.equal(SEED_PROJECTS.length, 12);
  assert.equal(SEED_PROJECTS.find((p) => p.slug === "golfn")?.section, false);
});
