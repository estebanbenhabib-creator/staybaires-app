// Service worker minimo: hace la app "instalable" (icono en el telefono) y
// cachea el shell estatico para que abra rapido y aunque haya mala senal.
// OJO: nunca cachea /api/* — esos datos (tareas, pagos, insumos) siempre
// tienen que venir frescos del servidor.

const CACHE = "staybaires-v1";
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

  // Datos: siempre a la red, sin cache.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) {
    return; // dejar que el navegador lo maneje normalmente
  }

  // Navegaciones: red primero, si falla cae al index cacheado (offline).
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html")));
    return;
  }

  // Estaticos del mismo origen: cache primero, si no esta va a la red y guarda.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
            return res;
          })
      )
    );
  }
});
