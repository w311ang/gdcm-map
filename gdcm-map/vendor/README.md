# vendor 目录

存放直接托管在本仓库、而非依赖外部 CDN 的第三方静态脚本。

## capacitor-core-6.2.2.js

来源：`https://unpkg.com/@capacitor/core@6.2.2/dist/capacitor.js`（官方 npm 发布包原文件，未做任何修改）

**为什么 vendor 而不是直接从 unpkg.com 加载**：unpkg 在部分地区访问较慢/不稳定，
而这个文件版本锁定、内容极小（约 10KB），直接托管在自己域名下更快更可靠，
且不受外部 CDN 波动影响。

**版本必须与 `android-app/package.json` 中 `@capacitor/core` 的实际安装版本保持一致**，
因为它要和原生 App 内置的 native-bridge.js 配合使用（协议不匹配可能导致插件调用失败）。

### 如何升级

1. 升级 `android-app/` 里的 `@capacitor/core`（`npm install @capacitor/core@<新版本>`）
2. 下载对应新版本文件替换本目录下的文件，并将文件名中的版本号一并改掉：
   ```bash
   curl -o vendor/capacitor-core-<新版本>.js \
     https://unpkg.com/@capacitor/core@<新版本>/dist/capacitor.js
   ```
3. 同步更新 `gdcm-map/index.html` 里 `loadCapacitorCore()` 的 `script.src` 路径，
   以及 `gdcm-map/service-worker.js` 里 `SHELL_ASSETS` 的对应路径
4. 删除旧版本文件

CI（`.github/workflows/docker-build.yml`）会在构建时自动校验
`android-app/package.json` 与本目录下 vendor 文件名的版本号是否一致，
遗漏更新会导致构建直接失败，不会静默发布出去。
