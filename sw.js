/* global importScripts */
// =======================================================================
// SERVICE WORKER — CATALOGUE AI (PWA)
// =======================================================================
// Chiến lược Cache thông minh:
// 1. Tuyệt đối không dính cache cũ khi nâng cấp phiên bản (Clear old caches on activate).
// 2. Tận dụng cache để khởi động tức thì và offline fallback an toàn.
// 3. API, Auth, /config.js và /version.json luôn lấy trực tiếp từ mạng (Never cache).
// 4. Navigation (HTML) dùng Network-First: Đảm bảo người dùng luôn thấy bản mới nhất khi có mạng.
// 5. Ảnh Catalogue / Media dùng cache riêng để tăng tốc độ lướt tra cứu.
// =======================================================================

try {
  importScripts('/src/version.js');
} catch (_) {}

const VERSION = (typeof self !== 'undefined' && self.APP_VERSION) || '6.1.1';
const CACHE_STATIC = `catalogue-static-v${VERSION}`;
const CACHE_MEDIA = `catalogue-media-v${VERSION}`;
const ACTIVE_CACHES = [CACHE_STATIC, CACHE_MEDIA];

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/src/version.js',
  '/src/app.js',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-book.png',
  '/assets/apple-touch-icon.png'
];

// Cài đặt SW mới — nạp sẵn khung ứng dụng (precache)
self.addEventListener('install', (event) => {
  // KHÔNG gọi skipWaiting() tại đây để giữ worker mới ở trạng thái waiting.
  // Điều này cho phép giao diện ứng dụng hiển thị thông báo "Phiên bản mới"
  // và để người dùng chủ động bấm "Cập nhật".
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Precache tài nguyên tĩnh không hoàn tất (bỏ qua):', err);
      });
    })
  );
});

// Kích hoạt SW mới — DỌN SẠCH TOÀN BỘ CACHE BẢN CŨ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (!ACTIVE_CACHES.includes(key)) {
            console.log('[SW] Xóa cache phiên bản cũ:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Nhận lệnh từ giao diện người dùng (ví dụ: bấm nút "Cập nhật ngay" hoặc "Xóa cache")
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data === 'SKIP_WAITING' || (data && data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
  if (data === 'CLEAR_CACHE' || (data && data.type === 'CLEAR_CACHE')) {
    caches.keys().then((keys) => {
      return Promise.all(keys.map((k) => caches.delete(k)));
    }).then(() => {
      console.log('[SW] Đã xóa sạch toàn bộ cache theo yêu cầu người dùng.');
    });
  }
});

// Điều phối yêu cầu mạng (Smart caching strategy)
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 0. CHỈ XỬ LÝ HTTP/HTTPS, BỎ QUA data:, blob:, chrome-extension: ĐỂ TRÁNH LỖI CACHE API
  if (!url.protocol.startsWith('http')) return;

  // 1. TUYỆT ĐỐI KHÔNG CACHE API, AUTH VÀ SUPABASE (NGOẠI TRỪ /api/media)
  if (url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/media/')) return;
  if (url.hostname.includes('supabase.co')) return;

  // 2. CONFIG RUNTIME VÀ CHECK VERSION LUÔN TƯƠI MỚI (NO-STORE)
  if (url.pathname === '/config.js' || url.pathname === '/version.json') {
    event.respondWith(
      fetch(req, { cache: 'no-store' }).catch(() => caches.match(req))
    );
    return;
  }

  // 3. HTML NAVIGATION -> NETWORK FIRST (để không dính shell HTML cũ)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_STATIC).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          return caches.match(req).then((cached) => cached || caches.match('/index.html') || caches.match('/'));
        })
    );
    return;
  }

  // 4. ẢNH MEDIA VÀ ASSETS -> CACHE-FIRST ĐỂ TĂNG TỐC ĐỘ XEM CATALOGUE
  if (url.pathname.startsWith('/api/media/') || url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(CACHE_MEDIA).then((cache) => {
        return cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((netRes) => {
            if (netRes && netRes.status === 200) {
              cache.put(req, netRes.clone());
            }
            return netRes;
          }).catch(() => null);
        });
      })
    );
    return;
  }

  // 5. STATIC ASSETS KHÁC (/src/*, /tools/*, CDN scripts) -> STALE-WHILE-REVALIDATE
  // Phục vụ tức thì từ cache, đồng thời fetch ngầm để cập nhật cho lần mở sau.
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req)
        .then((netRes) => {
          if (netRes && netRes.status === 200) {
            const clone = netRes.clone();
            caches.open(CACHE_STATIC).then((c) => c.put(req, clone));
          }
          return netRes;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
