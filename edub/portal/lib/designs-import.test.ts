import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, isArchived, noteTarget, pairHtmlPng, placeOf, platformOf, statusOf, tagsOf, titleOf } from "./designs-import-model.ts";

test("classify: images, html, svg, notes, root files, technical files", () => {
  assert.equal(classify("share-workout/screens/fin-seance.png").kind, "capture");
  assert.equal(classify("paywall/x.webp").kind, "capture");
  assert.equal(classify("home/home-v1.html").kind, "maquette-html");
  assert.equal(classify("assets/brand/logo.svg").kind, "svg");
  assert.equal(classify("watch/README.md").kind, "note");
  assert.equal(classify("index.html").kind, "ignored");
  assert.equal(classify("shared.css").kind, "ignored");
  assert.equal(classify("profile/make.py").kind, "ignored");
});

test("sections: folder → section, sub-folder → sub-section, resources apart, deeper folds into tags", () => {
  assert.deepEqual(placeOf("home/home-v1.html"), { root: "Home", sub: null, deeper: [] });
  assert.deepEqual(placeOf("share-workout/screens/a.png"), { root: "Share workout", sub: "Screens", deeper: [] });
  assert.deepEqual(placeOf("_wear-proposal/a.html"), { root: "Wear proposal", sub: null, deeper: [] });
  assert.deepEqual(placeOf("assets/tabs/a.png"), { root: "Ressources", sub: "assets / tabs", deeper: [] });
  assert.deepEqual(placeOf("exercise-images/femme/a.png"), { root: "Ressources", sub: "exercise-images / femme", deeper: [] });
  assert.deepEqual(placeOf("watch/wear-os/mockups/screens/a.png"), { root: "Watch", sub: "Wear os", deeper: ["mockups", "screens"] });
  assert.deepEqual(tagsOf("watch/wear-os/mockups/screens/a-v2.png"), ["watch", "mockups", "screens", "v2"]);
});

test("status and platform", () => {
  assert.equal(isArchived("archive/home/x.html"), true);
  assert.equal(isArchived("watch/archive-ed-0924/x.html"), true);
  assert.equal(statusOf("archive/home/x.html"), "obsolète");
  assert.equal(statusOf("assets/a.png"), "en prod");
  assert.equal(statusOf("home/a.html"), "proposé");
  assert.equal(platformOf("_wear-proposal/x.html"), "watch");
  assert.equal(platformOf("watch/apple-watch/x.png"), "watch");
  assert.equal(platformOf("emails/waitlist.html"), "email");
  assert.equal(platformOf("live-activity/ios/x.png"), "ios");
  assert.equal(platformOf("live-activity/android/x.png"), "android");
  assert.equal(platformOf("home/home-v1.html"), "autre");
  assert.equal(platformOf("workout/iosolated.png"), "autre");
});

test("titles", () => {
  assert.equal(titleOf("onboarding/step-1-gender-selection.html"), "Step 1 gender selection");
  assert.equal(titleOf("a/01_seance-du-jour.png"), "01 seance du jour");
});

test("html ↔ png pairing: same stem or -overview only", () => {
  const files = ["shop/shop.html", "shop/shop.png", "weight/w-v1.html", "weight/w-v1-overview.png", "rewards/r.html", "rewards/rewards-bg.png"];
  assert.deepEqual([...pairHtmlPng(files)], [["shop/shop.html", "shop/shop.png"], ["weight/w-v1.html", "weight/w-v1-overview.png"]]);
});

test("notes go to the screen with the same stem, else the folder", () => {
  const screens = new Set(["watch/apple-watch/apple-watch.html"]);
  assert.deepEqual(noteTarget("watch/apple-watch/apple-watch.md", screens), { screen: "watch/apple-watch/apple-watch.html" });
  assert.deepEqual(noteTarget("watch/README.md", screens), { dir: "watch" });
});
