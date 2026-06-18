// Service Worker לאפליקציית גלוברנס
// מאפשר התקנה כאפליקציה (PWA) באנדרואיד + עבודה בסיסית גם ללא אינטרנט.
// כשתעדכן את index.html, פשוט שנה את המספר ב-CACHE_NAME (למשל v3) כדי לרענן את המטמון.

const CACHE_NAME = 'globrands-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

// התקנה: שמירת קבצי הבסיס למטמון
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch(() => {})
  );
});

// הפעלה: ניקוי מטמונים ישנים
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// בקשות רשת
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // ניווט (טעינת הדף): קודם רשת (כדי לקבל עדכונים), ואם אין אינטרנט - מהמטמון
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // שאר הקבצים: קודם מהמטמון (מהיר), אחרת מהרשת ושמירה למטמון
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
