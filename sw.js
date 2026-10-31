// DECKTRACK service worker
// - Makes the site installable.
// - Keeps a copy of the app shell (page, styles, script, icons) and of the
//   Supabase library file, so the window still opens when the connection drops.
// - Never caches database traffic: borrow/return data always comes live
//   from Supabase so records are never stale.

const CACHE = "decktrack-shell-v2";

const SHELL = [
    "./",
    "./index.html",
    "./style.css",
    "./script.js",
    "./manifest.webmanifest",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./icons/apple-touch-icon.png"
];

// The one outside file the app needs to start (script.js calls it on line 1).
const LIBRARY_URL = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE)
            // Cache files one by one so a missing file doesn't block install.
            .then(cache => Promise.all([
                ...SHELL.map(url => cache.add(url).catch(() => null)),
                cache.add(new Request(LIBRARY_URL, { mode: "no-cors" }))
                    .catch(() => null)
            ]))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE).map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    const request = event.request;

    // Only plain GET requests are handled. Supabase API calls (another host,
    // and POST/PATCH/DELETE) go straight through untouched.
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    const isOwnFile = url.origin === self.location.origin;
    const isLibrary = request.url === LIBRARY_URL;

    if (!isOwnFile && !isLibrary) return;

    // Network first, so a new deploy shows up right away.
    // Fall back to the saved copy when offline.
    event.respondWith(
        fetch(request)
            .then(response => {
                // Files from another site come back "opaque", which is fine to keep.
                if (response && (response.ok || response.type === "opaque")) {
                    const copy = response.clone();
                    caches.open(CACHE).then(cache => cache.put(request, copy));
                }
                return response;
            })
            .catch(() =>
                caches.match(request).then(saved =>
                    saved || (request.mode === "navigate"
                        ? caches.match("./index.html")
                        : Response.error())
                )
            )
    );
});