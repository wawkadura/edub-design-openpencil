import assert from "node:assert/strict";
import { test } from "node:test";
import { inlineHtml, isLocalRef, type FetchRef } from "./designs-import-inline.ts";

const files: Record<string, string> = {
  "/d/shared.css": "body{background:url('assets/bg.png')} @font-face{src:url(f/x.ttf)}",
  "/d/shared.js": "window.x=1;</script>",
  "/d/assets/bg.png": "PNGDATA",
  "/d/f/x.ttf": "TTF",
  "/d/home/pic.png": "PIC",
};
const fetchRef: FetchRef = (base, ref) => {
  const abs = new URL(ref, `file://${base}/`).pathname;
  return abs in files ? { abs, data: Buffer.from(files[abs]!) } : null;
};

test("isLocalRef skips remote, data, anchors and placeholders", () => {
  for (const r of ["https://x/a.css", "//cdn/x.js", "data:image/png;base64,AA", "#a", "${AVA}", "{{ unsubscribe }}", "mailto:a@b", ""]) assert.equal(isLocalRef(r), false, r);
  assert.equal(isLocalRef("../shared.css"), true);
});

test("inlines stylesheet (with its own url()), script, img and style attributes", () => {
  const { html, report } = inlineHtml(
    '<head><link rel="stylesheet" href="../shared.css"><script src="../shared.js"></script></head><body><img src="pic.png" alt="a"><div style="background:url(pic.png)"></div></body>',
    "/d/home", fetchRef,
  );
  assert.ok(html.includes("<style>body{background:url(\"data:image/png;base64,"));
  assert.ok(html.includes('url("data:font/ttf;base64,'));
  assert.ok(html.includes("<script>window.x=1;<\\/script></script>"));
  assert.ok(html.includes('src="data:image/png;base64,'));
  assert.ok(html.includes("style=\"background:url('data:image/png;base64,"));
  assert.equal(report.missing.length, 0);
  assert.equal(report.inlined, 6);
  assert.ok(!/\.css"|href="\.\./.test(html));
});

test("missing and remote refs are left untouched and reported", () => {
  const src = '<link rel="stylesheet" href="nope.css"><img src="https://a/b.png"><img src="gone.png">';
  const { html, report } = inlineHtml(src, "/d/home", fetchRef);
  assert.equal(html, src);
  assert.deepEqual(report.missing, ["nope.css", "gone.png"]);
});
