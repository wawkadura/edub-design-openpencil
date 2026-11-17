/*
 * Edub Design — overlay of the editor page (ED_1730). Injected by nginx (sub_filter) into /editor,
 * never part of the upstream bundle. Public file (no secret, no user data): everything personal comes
 * from GET /api/edub/editor-context, which needs the session and answers 404 without a right.
 *
 *   - French + no auto-update defaults in the editor's own settings (read before the wasm mounts)
 *   - top bar: « ← Bibliothèque », breadcrumb project / folder / file, save indicator
 *   - viewer: banner + input guard (the server refuses the writes anyway: gate 403)
 *   - save conflict: « Recharger » / « Enregistrer une copie »
 *   - back gesture / browser Back closes panels and modals, never the editor
 */
(function () {
  "use strict";
  var params = new URLSearchParams(location.search);
  var tenant = params.get("tenant") || "";

  // ── 1. editor settings: French, no update check (outbound). Only filled when absent / forced.
  try {
    var KEY = "openpencil-rust-web-settings::anon";
    var cur = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!cur) {
      cur = {
        version: 1, theme: "dark", locale: "fr", mcp_port: 3100,
        mcp_cli_enabled: new Array(13).fill(false), images_advanced_open: false,
        experimental_features_enabled: false, image_gen_enabled: false, recent_files: [],
        entry_surface: "canvas",
      };
    }
    cur.auto_update_enabled = false;
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch (e) {}

  // ── 2. state + save tracking (fetch wrapper installed BEFORE the wasm shell loads)
  var ctx = null;
  var inflight = 0;
  var lastError = null; // null | "offline" | "readonly" | "conflict" | "error"
  var shownSaving = false;
  var listeners = [];
  function emit() { listeners.forEach(function (f) { f(); }); }
  function isWrite(method, url) {
    if (/^(GET|HEAD|OPTIONS)$/i.test(method)) return false;
    try { return new URL(url, location.href).pathname.indexOf("/api/mcp/") === 0; } catch (e) { return false; }
  }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var req = typeof input === "string" || input instanceof URL ? null : input;
    var url = req ? req.url : String(input);
    var method = (init && init.method) || (req && req.method) || "GET";
    if (!isWrite(method, url)) return realFetch(input, init);
    inflight++; emit();
    return realFetch(input, init).then(function (res) {
      inflight--;
      if (res.status === 403) lastError = "readonly";
      else if (res.status === 409 || res.status === 412) lastError = "conflict";
      else if (res.status >= 500) lastError = "error";
      else if (res.ok) lastError = null;
      emit();
      return res;
    }, function (err) {
      inflight--; lastError = "offline"; emit();
      throw err;
    });
  };

  // The host sends its writes with XMLHttpRequest (live_sync.rs), not fetch: track those too.
  var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__edub = { method: String(method), url: String(url) };
    return XO.apply(this, arguments);
  };
  function fakeDone(xhr, status, text) {
    Object.defineProperty(xhr, "status", { value: status, configurable: true });
    Object.defineProperty(xhr, "responseText", { value: text, configurable: true });
    Object.defineProperty(xhr, "readyState", { value: 4, configurable: true });
    ["readystatechange", "load", "loadend"].forEach(function (t) {
      var ev = new ProgressEvent(t);
      var h = xhr["on" + t]; if (typeof h === "function") h.call(xhr, ev);
      xhr.dispatchEvent(ev);
    });
  }
  XMLHttpRequest.prototype.send = function (body) {
    var m = this.__edub;
    var path = ""; try { path = m ? new URL(m.url, location.href).pathname : ""; } catch (e) {}
    // « Enregistrer » (Ctrl+S / menu): the host's disk save is closed on Edub; commit a version in the portal instead.
    if (m && /^POST$/i.test(m.method) && path === "/api/file/save") {
      var self = this;
      Promise.resolve(ctx).then(function () {
        if (!ctx || !ctx.canWrite) return fakeDone(self, 403, JSON.stringify({ ok: false, error: "Lecture seule" }));
        return waitIdle().then(function () {
          return realFetch("/api/edub/files/" + ctx.file.id + "/versions", { method: "POST", credentials: "same-origin" });
        }).then(function (r) {
          if (!r.ok) throw new Error("save " + r.status);
          flash("Version enregistrée ✓");
          fakeDone(self, 200, JSON.stringify({ ok: true, fileName: ctx.file.name + ".op" }));
        });
      }).catch(function () { fakeDone(self, 500, JSON.stringify({ ok: false, error: "Enregistrement impossible" })); });
      return;
    }
    if (m && isWrite(m.method, m.url)) {
      inflight++; emit();
      var xhr = this;
      xhr.addEventListener("loadend", function () {
        inflight--;
        var st = xhr.status;
        if (st === 0) lastError = "offline";
        else if (st === 403) lastError = "readonly";
        else if (st === 409 || st === 412) lastError = "conflict";
        else if (st >= 500) lastError = "error";
        else lastError = null;
        emit();
      });
    }
    return XS.apply(this, arguments);
  };
  function waitIdle() {
    return new Promise(function (ok) {
      var n = 0; (function t() { if (inflight === 0 || n++ > 40) ok(); else setTimeout(t, 100); })();
    });
  }
  window.addEventListener("offline", function () { lastError = "offline"; emit(); });
  window.addEventListener("online", function () { if (lastError === "offline") lastError = null; emit(); });
  if (navigator.onLine === false) lastError = "offline";

  // ── 3. context + UI
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "style") n.style.cssText = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }
  var CSS =
    ":host{all:initial}" +
    ".bar{position:fixed;top:4px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:10px;" +
    "max-width:min(720px,calc(100vw - 16px));padding:3px 6px 3px 3px;border-radius:999px;background:rgba(21,21,28,.92);" +
    "border:1px solid #26262f;color:#ececf1;font:12px/1.2 ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;" +
    "box-shadow:0 4px 18px rgba(0,0,0,.4);backdrop-filter:blur(8px)}" +
    "a.back{display:inline-flex;align-items:center;gap:4px;padding:6px 10px;border-radius:999px;background:#26262f;color:#ececf1;text-decoration:none;white-space:nowrap}" +
    "a.back:hover{background:#7c6cff}" +
    ".crumb{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;color:#9a9aa8}" +
    ".crumb b{color:#ececf1;font-weight:600}" +
    ".st{white-space:nowrap;padding:0 8px;color:#9a9aa8}.st.ok{color:#7ddc9b}.st.bad{color:#ff8a80}" +
    ".ro{padding:3px 9px;border-radius:999px;background:#ffcc66;color:#1a1300;font-weight:600;white-space:nowrap}" +
    ".veil{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:14px/1.5 ui-sans-serif,system-ui,sans-serif}" +
    ".dlg{max-width:440px;margin:16px;padding:20px;border-radius:14px;background:#15151c;border:1px solid #26262f;color:#ececf1}" +
    ".dlg h2{margin:0 0 8px;font-size:16px}.dlg p{margin:0 0 16px;color:#9a9aa8}" +
    ".row{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}" +
    "button,a.btn{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #26262f;background:#26262f;color:#ececf1;cursor:pointer;text-decoration:none}" +
    "button.pri{background:#7c6cff;border-color:#7c6cff}";
  var host, root, bar, stEl, crumbEl;

  function build() {
    host = el("div", { id: "edub-shell" });
    root = host.attachShadow({ mode: "open" });
    root.appendChild(el("style", { text: CSS }));
    var back = el("a", { class: "back", href: ctx.links.library, title: "Retour au projet", text: "← Bibliothèque" });
    back.addEventListener("click", function () { leaving = true; });
    crumbEl = el("span", { class: "crumb" });
    var parts = [];
    parts.push((ctx.project.emoji ? ctx.project.emoji + " " : "") + ctx.project.name);
    ctx.folders.forEach(function (f) { parts.push(f.name); });
    crumbEl.appendChild(document.createTextNode(parts.join(" / ") + " / "));
    crumbEl.appendChild(el("b", { text: ctx.file.name }));
    stEl = el("span", { class: "st" });
    var kids = [back, crumbEl, stEl];
    if (!ctx.canWrite) kids.push(el("span", { class: "ro", text: "Lecture seule" }));
    bar = el("div", { class: "bar", role: "navigation", "aria-label": "Edub Design" }, kids);
    root.appendChild(bar);
    document.body.appendChild(host);
    listeners.push(render);
    render();
  }

  var savingSince = 0, settleTimer = 0;
  function render() {
    if (!stEl) return;
    var text, cls = "st";
    if (!ctx.canWrite) { text = ""; }
    else if (lastError === "offline") { text = "Hors ligne"; cls += " bad"; }
    else if (lastError === "readonly") { text = "Non enregistré"; cls += " bad"; }
    else if (lastError === "conflict") { text = "Conflit"; cls += " bad"; }
    else if (lastError === "error") { text = "Échec de l’enregistrement"; cls += " bad"; }
    else if (inflight > 0) { text = "Enregistrement…"; savingSince = Date.now(); shownSaving = true; }
    else if (shownSaving && Date.now() - savingSince < 700) {
      text = "Enregistrement…";
      clearTimeout(settleTimer); settleTimer = setTimeout(render, 720 - (Date.now() - savingSince));
    } else { shownSaving = false; text = "Enregistré ✓"; cls += " ok"; }
    stEl.className = cls; stEl.textContent = text;
    if (ctx.canWrite && lastError === "conflict") conflictDialog();
    if (!ctx.canWrite && lastError === "readonly") { lastError = null; }
  }

  var dialog = null;
  function closeDialog() { if (dialog) { dialog.remove(); dialog = null; } }
  function conflictDialog() {
    if (dialog) return;
    var msg = el("p", { text: "Quelqu’un d’autre a modifié ce fichier en même temps : votre dernière modification n’a pas pu être enregistrée. Rechargez la dernière version, ou gardez votre travail dans une copie." });
    var note = el("p", { style: "display:none", text: "" });
    var reload = el("button", { class: "pri", text: "Recharger", onclick: function () { leaving = true; location.reload(); } });
    var copy = el("button", { text: "Enregistrer une copie", onclick: function () {
      copy.disabled = true; copy.textContent = "Copie en cours…";
      saveCopy().then(function (name) {
        note.style.display = ""; note.textContent = "Copie enregistrée dans la bibliothèque : « " + name + " ».";
        copy.style.display = "none";
      }, function () { copy.disabled = false; copy.textContent = "Enregistrer une copie"; note.style.display = ""; note.textContent = "La copie a échoué. Réessayez."; });
    } });
    dialog = el("div", { class: "veil" }, [el("div", { class: "dlg", role: "alertdialog" }, [el("h2", { text: "Conflit d’enregistrement" }), msg, note, el("div", { class: "row" }, [copy, reload])])]);
    root.appendChild(dialog);
  }
  function saveCopy() {
    var q = "?tenant=" + encodeURIComponent(tenant);
    return realFetch("/api/mcp/document" + q, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("read " + r.status);
      return r.text();
    }).then(function (body) {
      var name = ctx.file.name + " (copie)";
      var form = new FormData();
      form.append("file", new Blob([body], { type: "application/json" }), "copie.op");
      form.append("name", name);
      var last = ctx.folders[ctx.folders.length - 1];
      if (last) form.append("folderId", last.id);
      return realFetch("/api/edub/projects/" + encodeURIComponent(ctx.project.slug) + "/files", { method: "POST", body: form, credentials: "same-origin" })
        .then(function (r) { if (!r.ok) throw new Error("copy " + r.status); return name; });
    });
  }


  // ── 3b. « Ouvrir » / « Enregistrer sous » : the portal library instead of the visitor's disk
  var toastEl = null;
  function flash(text) {
    if (!root) return;
    if (toastEl) toastEl.remove();
    toastEl = el("div", { style: "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483002;padding:8px 14px;border-radius:999px;background:#15151c;border:1px solid #26262f;color:#ececf1;font:13px ui-sans-serif,system-ui,sans-serif", text: text });
    root.appendChild(toastEl);
    var t = toastEl; setTimeout(function () { t.remove(); }, 2600);
  }
  function api(path, init) {
    return realFetch(path, Object.assign({ credentials: "same-origin" }, init || {})).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }
  function libraryDialog(mode, blobText) {
    // mode "open" | "saveas". Lists only the projects the portal says we can see.
    if (dialog) return;
    var title = mode === "open" ? "Ouvrir un fichier" : "Enregistrer sous";
    var list = el("div", { style: "max-height:46vh;overflow:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:12px" });
    var nameIn = el("input", { type: "text", value: ctx ? ctx.file.name + " (copie)" : "", style: "display:" + (mode === "open" ? "none" : "block") + ";box-sizing:border-box;width:100%;margin-bottom:10px;padding:8px;border-radius:8px;border:1px solid #26262f;background:#0b0b0f;color:#ececf1;font:inherit" });
    var cancel = el("button", { text: "Annuler", onclick: closeDialog });
    dialog = el("div", { class: "veil" }, [el("div", { class: "dlg", role: "dialog", style: "width:min(460px,100%)" }, [el("h2", { text: title }), nameIn, list, el("div", { class: "row" }, [cancel])])]);
    root.appendChild(dialog);
    function row(label, onclick, sub) {
      var b = el("button", { style: "text-align:left;display:flex;justify-content:space-between;gap:8px", onclick: onclick }, [el("span", { text: label }), el("span", { style: "color:#9a9aa8", text: sub || "" })]);
      list.appendChild(b); return b;
    }
    list.appendChild(el("p", { style: "margin:0", text: "Chargement…" }));
    api("/api/edub/projects").then(function (d) {
      list.textContent = "";
      var ps = d.projects.filter(function (p) { return mode === "open" || p.role !== "viewer"; });
      if (!ps.length) list.appendChild(el("p", { style: "margin:0", text: "Aucun projet disponible." }));
      ps.forEach(function (p) {
        row((p.emoji ? p.emoji + " " : "") + p.name, function () { showProject(p); }, p.fileCount + " fichier(s)");
      });
    }).catch(function () { list.textContent = "Bibliothèque indisponible."; });
    function showProject(p) {
      list.textContent = "";
      row("← Projets", function () { closeDialog(); libraryDialog(mode, blobText); });
      api("/api/edub/projects/" + encodeURIComponent(p.slug)).then(function (d) {
        if (mode === "open") {
          d.files.forEach(function (f) {
            row(f.name, function () { leaving = true; location.assign("/editor?tenant=" + encodeURIComponent(f.tenantId)); }, f.screenCount + " écran(s)");
          });
          if (!d.files.length) list.appendChild(el("p", { style: "margin:0", text: "Projet vide." }));
        } else {
          row("Enregistrer ici : " + p.name + " (racine)", function () { doSave(p.slug, null); });
          d.folders.forEach(function (f) { row("📁 " + f.name, function () { doSave(p.slug, f.id); }); });
        }
      }).catch(function () { list.appendChild(el("p", { style: "margin:0", text: "Projet indisponible." })); });
    }
    function doSave(slug, folderId) {
      var name = (nameIn.value || "Sans titre").trim();
      var form = new FormData();
      form.append("file", new Blob([blobText], { type: "application/json" }), "copie.op");
      form.append("name", name);
      if (folderId) form.append("folderId", folderId);
      api("/api/edub/projects/" + encodeURIComponent(slug) + "/files", { method: "POST", body: form })
        .then(function () { closeDialog(); flash("Enregistré dans la bibliothèque : « " + name + " »"); })
        .catch(function () { flash("Échec de l’enregistrement"); });
    }
  }
  // Open: the editor creates <input type=file accept=".op,.pen"> and clicks it.
  var IC = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type === "file" && /(^|,)\.op(,|$)/.test(this.accept || "") && /\.pen/.test(this.accept || "") && !/\.json/.test(this.accept || "")) {
      this.remove(); libraryDialog("open"); return;
    }
    return IC.apply(this, arguments);
  };
  // Save as: the editor downloads the .op through a synthetic <a download="….op">.
  // blobs are read through the object itself (a fetch of blob: would need CSP connect-src blob:)
  var blobs = {}, COU = URL.createObjectURL;
  URL.createObjectURL = function (b) { var u = COU.call(URL, b); if (b instanceof Blob) blobs[u] = b; return u; };
  var AC = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var dl = this.getAttribute("download") || "";
    if (/\.(op|pen)$/i.test(dl) && /^blob:/.test(this.href) && ctx && ctx.canWrite) {
      var blob = blobs[this.href];
      if (blob) { blob.text().then(function (t) { libraryDialog("saveas", t); }); return; }
    }
    return AC.apply(this, arguments);
  };

  // ── 4. viewer: no edit input reaches the editor (server refuses writes regardless)
  var spaceDown = false;
  function viewerGuard() {
    var ZOOM_KEYS = /^[-+=_0123]$/;
    window.addEventListener("keydown", function (e) {
      if (e.key === " ") { spaceDown = true; return; }
      if (e.key === "Escape" || e.key === "Shift" || e.key === "Control" || e.key === "Meta" || e.key === "Alt") return;
      var mod = e.ctrlKey || e.metaKey;
      if (mod && /^[acf]$/i.test(e.key)) return; // select-all / copy / search stay harmless
      if (ZOOM_KEYS.test(e.key) && (mod || e.shiftKey)) return;
      if (e.key.indexOf("Arrow") === 0 && !mod && !e.shiftKey) { e.stopImmediatePropagation(); e.preventDefault(); return; }
      e.stopImmediatePropagation(); e.preventDefault();
    }, true);
    window.addEventListener("keyup", function (e) { if (e.key === " ") spaceDown = false; }, true);
    // A left-button drag would move / resize / draw: swallow the moves unless panning (space).
    window.addEventListener("pointermove", function (e) {
      if ((e.buttons & 1) && !spaceDown) { e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener("mousemove", function (e) {
      if ((e.buttons & 1) && !spaceDown) { e.stopImmediatePropagation(); }
    }, true);
    window.addEventListener("dblclick", function (e) { e.stopImmediatePropagation(); e.preventDefault(); }, true);
    window.addEventListener("paste", function (e) { e.stopImmediatePropagation(); e.preventDefault(); }, true);
    window.addEventListener("cut", function (e) { e.stopImmediatePropagation(); e.preventDefault(); }, true);
    window.addEventListener("drop", function (e) { e.stopImmediatePropagation(); e.preventDefault(); }, true);
    window.addEventListener("dragover", function (e) { e.preventDefault(); }, true);
  }

  // ── 5. back gesture: close panels/modals (Escape), never leave the editor
  var leaving = false;
  function backTrap() {
    function arm() { try { history.pushState({ edub: 1 }, "", location.href); } catch (e) {} }
    arm();
    window.addEventListener("popstate", function () {
      if (leaving) return;
      arm();
      if (dialog) { if (ctx && ctx.canWrite) { /* conflict dialog needs an explicit choice */ } return; }
      var target = document.querySelector("canvas") || document.body;
      ["keydown", "keyup"].forEach(function (t) {
        target.dispatchEvent(new KeyboardEvent(t, { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true }));
      });
    });
  }
  backTrap();

  // ── 6. boot
  function boot(attempt) {
    if (!/^f_[0-9a-f]{32}$/.test(tenant)) return;
    realFetch("/api/edub/editor-context?tenant=" + encodeURIComponent(tenant), { credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error("ctx " + r.status); return r.json(); })
      .then(function (c) {
        ctx = c;
        document.title = c.file.name + " — Edub Design";
        if (!c.canWrite) viewerGuard();
        var go = function () { build(); };
        if (document.body) go(); else document.addEventListener("DOMContentLoaded", go);
      })
      .catch(function () { if (attempt < 3) setTimeout(function () { boot(attempt + 1); }, 1500 * (attempt + 1)); });
  }
  // A viewer must be locked before the first input, not after the context call: lock first, unlock if proven writable.
  boot(0);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(function () {}); });
  }
})();
