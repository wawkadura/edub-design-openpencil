import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "./markdown.ts";
import { extractMentions, extractTickets, HTML_CSP, looksLikeHtml, parseLinks, parsePlatform, parseStatus, parseTags, parseType, safeUrl, titleFromFilename } from "./screens-model.ts";

test("platform / status / type accept ASCII aliases, reject the rest", () => {
  assert.equal(parsePlatform("iOS"), "ios");
  assert.equal(parsePlatform("palmos"), null);
  assert.equal(parseStatus("propose"), "proposé");
  assert.equal(parseStatus("En-Prod"), "en prod");
  assert.equal(parseStatus("en prod"), "en prod");
  assert.equal(parseStatus("obsolete"), "obsolète");
  assert.equal(parseStatus("nope"), null);
  assert.equal(parseType("html"), "maquette-html");
  assert.equal(parseType("capture"), "capture");
  assert.equal(parseType("pdf"), null);
});

test("links: tickets, PRs, urls; javascript: is refused", () => {
  assert.deepEqual(parseLinks(["ed_1234", "https://github.com/x/y/pull/12", { url: "https://a.fr/x", label: "Spec" }]), [
    { type: "ticket", ref: "ED_1234" },
    { type: "pr", url: "https://github.com/x/y/pull/12" },
    { type: "url", url: "https://a.fr/x", label: "Spec" },
  ]);
  assert.equal(parseLinks(["javascript:alert(1)"]), null);
  assert.equal(parseLinks("nope"), null);
  assert.equal(safeUrl("data:text/html,x"), null);
});

test("tickets, tags, mentions, title", () => {
  assert.deepEqual(extractTickets("voir ED_1731 et ed_1729, pas ED_12"), ["ED_1731", "ED_1729"]);
  assert.deepEqual(parseTags("Home, Onboarding Flow ,home"), ["home", "onboarding-flow"]);
  assert.deepEqual(extractMentions("hey @Alice, cc @bob.\nmail a@b.fr"), ["alice", "bob"]);
  assert.equal(titleFromFilename("paywall_v2-final.png"), "paywall v2 final");
});

test("html detection and the sandbox CSP", () => {
  assert.equal(looksLikeHtml("x.html", undefined, ""), true);
  assert.equal(looksLikeHtml("x", undefined, "  <!DOCTYPE html><html>"), true);
  assert.equal(looksLikeHtml("x.bin", "application/octet-stream", "\u0000\u0001"), false);
  assert.match(HTML_CSP, /^sandbox allow-scripts;/);
  assert.doesNotMatch(HTML_CSP, /allow-same-origin/);
  assert.match(HTML_CSP, /connect-src 'none'/);
});

test("markdown escapes HTML and only emits http(s) links", () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> **gras** [x](javascript:alert(1)) [ok](https://a.fr/?a=1&b=2) ED_1731 @alice @ghost\n- un\n- deux', ["alice"]);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.match(html, /<strong>gras<\/strong>/);
  assert.match(html, /href="https:\/\/a\.fr\/\?a=1&amp;b=2"/);
  assert.match(html, /href="https:\/\/dev\.edub\.fr\/\?todo=ED_1731"/);
  assert.match(html, /<span class="mention">@alice<\/span>/);
  assert.doesNotMatch(html, /mention">@ghost/);
  assert.match(html, /<ul><li>un<\/li><li>deux<\/li><\/ul>/);
});
