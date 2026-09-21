// 极简 Service Worker：仅为实现 PWA 可安装/离线外壳缓存，
// 不缓存 Google Maps 反代相关请求（瓦片、JS、静态资源），
// 避免地图内容被过期/离线数据污染。
// @capacitor/core（vendor 到本仓库，见 vendor/ 目录说明）属于版本锁定的静态脚本，
// 内容不会变化，缓存它能加快该脚本的二次加载。
const CACHE_NAME = "campus-map-shell-v4";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./vendor/capacitor-core-6.2.2.js"
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

  // 应用外壳资源：网络优先，失败时回退到缓存，便于离线也能打开界面骨架
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
