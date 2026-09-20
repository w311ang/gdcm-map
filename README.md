# gdcm-map

校园卫星地图 Web 应用，基于 Google Maps JavaScript API，具备以下特性：

- 卫星地图 + 实时定位（一键定位按钮）与设备朝向（指南针）显示
- 服务端反向代理 Google Maps 请求，隐藏 API Key，不在客户端暴露
- 自定义 Caddy 模块 `caddy-tilebounds`，在反代层强制限制可查看的地理区域（防止越权查看限定范围外的卫星影像）
- 可安装 PWA（manifest + service worker + 图标）

## 目录结构

- `gdcm-map/`：前端静态资源（`index.html`、`manifest.webmanifest`、`service-worker.js`、图标）
- `caddy-tilebounds/`：自定义 Go 编写的 Caddy HTTP 处理模块源码，用于按瓦片坐标做地理区域校验
- `deploy/`：Docker 部署相关文件

## 镜像构建（GitHub Actions）

推送到 `main` 分支（涉及 `gdcm-map/`、`caddy-tilebounds/`、`deploy/Dockerfile` 等路径）会自动触发 `.github/workflows/docker-build.yml`，构建镜像并推送到 GitHub Container Registry：`ghcr.io/w311ang/gdcm-map:latest`。

**首次使用前，需要手动将该 GHCR 包设为 Public**（否则服务器 `docker pull` 时会因未登录而失败）：仓库页面 → 右侧 Packages → 进入 `gdcm-map` 包 → Package settings → Change visibility → Public。

## 部署（Docker，服务器直接拉取预构建镜像）

1. 准备 Google Maps API Key。
2. 进入 `deploy/` 目录，复制 `.env.example` 为 `.env` 并填入真实 Key：

   ```bash
   cd deploy
   cp .env.example .env
   # 编辑 .env，填入 GOOGLE_MAPS_API_KEY
   ```

3. 拉取镜像并启动容器（默认只绑定到 `127.0.0.1:12856`，不直接暴露公网；服务器本地不再需要编译 Go/Caddy）：

   ```bash
   docker compose pull
   docker compose up -d
   ```

4. 在宿主机上已有的 Caddy 中加入反向代理站点块（参考 `deploy/host-caddy-snippet.conf`），换成你自己的域名后 reload：

   ```
   map.yourdomain.com {
       reverse_proxy 127.0.0.1:12856
   }
   ```

## 地理区域限制配置

`deploy/Caddyfile.docker` 中的 `(allowed_bounds)` 片段定义了允许查看的经纬度范围，按需修改后重新构建镜像即可生效：

```
tile_bounds {
    min_lat 23.721844
    max_lat 23.762603
    min_lng 113.073930
    max_lng 113.119559
}
```

## PWA 安装说明

- 首次安装后如修改了 `manifest.webmanifest`，Android 端需要卸载重装 WebAPK 才能生效（系统对已安装 PWA 的 manifest 有缓存）。
