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
- `android-app/`：Capacitor 封装的 Android 原生壳应用（见下方「Android 原生 App」章节）

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

## Android 原生 App（`android-app/`）

网页版指南针受限于浏览器 `DeviceOrientationEvent`（无系统级传感器融合，精度低、易抖动/反向）。
`android-app/` 用 [Capacitor](https://capacitorjs.com/) 把线上网页封装成 Android 原生 App，
额外注入一个自定义原生插件 `CompassPlugin`（见 `android-app/android/app/src/main/java/xyz/z543998/gdcmmap/compass/CompassPlugin.kt`），
直接读取系统 `TYPE_ROTATION_VECTOR` 传感器（与原生地图/导航 App 同源、经系统融合与滤波），网页侧检测到运行在该原生壳内时会优先使用它；
iOS 仍然通过 Safari 自带的 `webkitCompassHeading` 获取方向，未使用 Capacitor 封装。

**架构说明**：`android-app/capacitor.config.json` 中的 `server.url` 指向线上地址，
即原生壳只是加了一层带指南针插件的 WebView，实际页面内容仍从服务器实时加载，不在 APK 内打包快照，
因此现网页更新后无需重新发 APK。**已知风险**：Capacitor 官方文档指出 `server.url` 远程加载模式下，
原生插件桥接在部分场景下可能失效（社区反馈多发生在页面内发生整页跳转之后）；本应用是单页应用，
不会发生整页导航，理论上不受影响，但建议实际安装测试后再确认指南针功能正常。

真实域名不写入仓库：`android-app/capacitor.config.json` 已加入 `.gitignore`，实际提交的是
`android-app/capacitor.config.template.json`（内含占位符 `__CAPACITOR_SERVER_URL__`）。
CI 构建时从仓库 Secret `MAP_SERVER_URL` 读取真实地址并生成正式配置（见下方「构建 APK」）。

### 构建 APK

推送到 `main` 分支（涉及 `android-app/**`）会自动触发 `.github/workflows/android-build.yml`，
用 GitHub Actions 编译 **未签名的 Debug APK**，可在该次工作流运行的 Artifacts 里下载 `gdcm-map-debug-apk`，
下载后直接在手机上"允许安装未知来源应用"后安装即可（仅供内部测试/自用，未走应用商店签名与上架流程）。

**首次使用前，需要在仓库 Settings → Secrets and variables → Actions 中添加一个 Secret**：
`MAP_SERVER_URL`，值为你的线上地址（例如 `https://map.example.com`）。未配置时 CI 会直接报错终止，
提醒你补上，不会静默用空值构建。

如需本地构建（需要 Node.js 22+、JDK 17+、Android SDK）：

```bash
cd android-app
npm install
sed "s#__CAPACITOR_SERVER_URL__#https://你的真实域名#" capacitor.config.template.json > capacitor.config.json
npx cap sync android
cd android
./gradlew assembleDebug
# 产物：android-app/android/app/build/outputs/apk/debug/app-debug.apk
```

