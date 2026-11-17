// Edub Design service worker: installability only. Never caches anything (documents are private
// and authenticated), never intercepts: every request goes straight to the network.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
