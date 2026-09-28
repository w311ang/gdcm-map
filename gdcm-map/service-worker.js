// 极简 Service Worker：实现 PWA 可安装/离线外壳缓存（stale-while-revalidate），
// 不缓存 Google Maps 反代相关请求（瓦片、JS、静态资源），
// 避免地图内容被过期/离线数据污染。
const CACHE_NAME = "campus-map-shell-v6";
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
  const url = new URL(event.request.url);

  // 反代路径（Google Maps JS/静态资源/瓦片）一律直接走网络，不经过 Service Worker 缓存，
  // 保证地图数据始终最新，且不会意外把 API Key 注入逻辑绕过。
  if (url.pathname.startsWith("/gmaps-js/") ||
      url.pathname.startsWith("/gmaps-static/") ||
      url.pathname.startsWith("/gmaps-tile/")) {
    return; // 不调用 respondWith，浏览器按默认网络请求处理
  }

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
