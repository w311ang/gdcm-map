// 极简 Service Worker：对所有 GET 请求（含 Google Maps 反代的 JS、配置、瓦片）
// 使用 stale-while-revalidate 缓存，实现 PWA 可安装与离线访问。
const CACHE_NAME = "campus-map-shell-v7";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  // Cache API 只能存 GET 请求
  if (event.request.method !== "GET") return;

  // 应用外壳资源：stale-while-revalidate。有缓存就立即返回，同时后台请求网络更新缓存，
  // 内容更新会在下一次打开时生效；没有缓存时等待网络。
  const networkUpdate = fetch(event.request).then((response) => {
    // 只缓存成功响应；opaque 响应的 ok 为 false，也会被跳过
    if (response.ok) {
      const copy = response.clone();
      return caches.open(CACHE_NAME)
        .then((cache) => cache.put(event.request, copy))
        .then(() => response);
    }
    return response;
  });

  // 让 SW 在后台更新完成前保持存活；离线时的网络错误在这里吞掉
  event.waitUntil(networkUpdate.catch(() => {}));

  event.respondWith(
    caches.match(event.request).then((cached) => cached || networkUpdate)
  );
});
