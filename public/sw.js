// Service worker: hace la app "instalable" (icono en el telefono) y da un
// fallback offline, SIN quedarse pegado a una version vieja del codigo.
//
// Estrategia network-first para todo lo del mismo origen: si hay red, siempre
// sirve la version fresca (asi los deploys se ven al instante) y de paso la
// guarda en cache; si no hay red, cae a lo ultimo cacheado. Los datos (/api/*)
// nunca pasan por el SW: van directo a la red.

const CACHE = "staybaires-v2";
const SHELL = [
  "/",
  "/index.html",
  "/assets/app.js",
  "/assets/styles.css",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Datos y funciones: siempre a la red, sin tocar el SW.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;
  // Otros origenes (CDNs, etc.): sin intervencion.
  if (url.origin !== self.location.origin) return;

  // Mismo origen (shell y assets): red primero, cache como respaldo offline.
  event.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || (request.mode === "navigate" ? caches.match("/index.html") : Response.error()))
      )
  );
});
