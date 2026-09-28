# gdcm-map

校园卫星地图 PWA，使用 Cloudflare Workers 静态资源托管与 Worker 反代 Google Maps API：

- API Key 作为 Cloudflare Worker Secret 保存，不提交到代码或浏览器
- Worker 重写 Google Maps 脚本中的上游地址，使瓦片及静态资源仍经本 Worker 请求
- Worker 在代理层检查瓦片地理范围；无法解析坐标或瓦片越界时拒绝请求
- 支持 PWA、定位和浏览器设备朝向

## 目录结构

- `gdcm-map/`：PWA 静态资源
- `src/index.js`：Cloudflare Worker 路由、Google Maps 反代和瓦片区域校验
- `wrangler.toml`：Worker 与静态资源配置
- `test/`：Worker 逻辑的 Node.js 单元测试
- Git 分支 `docker-mode`：Cloudflare Workers 迁移前的完整 Docker/Caddy 部署版本

## 部署到 Cloudflare Workers

需要一个 Cloudflare 账号，并将要使用的域名托管在该账号的 Cloudflare DNS 中。

1. 安装 Node.js 22+，并从项目根目录安装依赖、登录 Wrangler：

   ```bash
   npm ci
   npx wrangler login
   ```

2. 将 Google Maps API Key 写入 Worker Secret。CLI 会在终端提示输入值；不要把密钥写入 `wrangler.toml`、源码或命令历史：

   ```bash
   npx wrangler secret put GOOGLE_MAPS_API_KEY
   ```

3. 部署 Worker 和 `gdcm-map/` 静态资源：

   ```bash
   npx wrangler deploy
   ```

4. 先访问 Wrangler 输出的 `*.workers.dev` 地址验证地图、瓦片及 PWA。确认正常后，在 Cloudflare Dashboard 的 **Workers & Pages → gdcm-map → Settings → Domains & Routes** 添加自定义域名。

   如果自定义域名目前指向旧服务器，应在 Cloudflare 中将该 DNS/路由切换到 Worker；建议先保留旧服务器配置，待 Worker 验证完成后再停用旧服务。

`wrangler.toml` 使用 `workers_dev = true` 并将静态文件绑定到 `ASSETS`。只有 `/gmaps-js/*`、`/gmaps-static/*` 和 `/gmaps-tile/*` 会先进入 Worker，其余请求由 Workers Static Assets 直接提供。

### GitHub Actions 部署（可选）

`.github/workflows/worker-deploy.yml` 仅手动触发。要使用它，在 GitHub 仓库 Actions secrets 中配置：

- `CF_API_TOKEN`：具有目标账号 Workers Scripts 部署权限的 Cloudflare API Token
- `CF_ACCOUNT_ID`：Cloudflare Account ID

首次部署前仍需按上述步骤运行一次 `wrangler secret put GOOGLE_MAPS_API_KEY`；Worker Secret 不存放在 GitHub。

## 地理区域限制

`src/index.js` 中的 `ALLOWED_BOUNDS` 定义允许查看的经纬度范围。Worker 只放行**整张瓦片完全位于**该范围内的请求；越界瓦片或无法识别坐标的瓦片请求都会以 403 拒绝。这项检查在服务端执行，不能通过修改客户端地图范围绕过。

## 本地开发与测试

```bash
npm test
npm run dev
```

本地运行 Worker 前，需要通过 `.dev.vars` 配置 `GOOGLE_MAPS_API_KEY`；该文件不得提交到仓库。

## PWA 说明

- Service Worker 文件配置为不长期缓存，避免用户继续使用旧版本缓存策略。
- 首次安装后如修改 `manifest.webmanifest`，Android 端可能需要卸载重装 WebAPK 才能应用 manifest 更新。
