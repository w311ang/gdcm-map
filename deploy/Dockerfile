# 构建阶段：编译带自定义模块的 Caddy 二进制
FROM golang:1.24-bookworm AS builder

RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest

WORKDIR /build
COPY caddy-tilebounds ./caddy-tilebounds

RUN xcaddy build v2.9.1 \
    --with github.com/caddyserver/replace-response \
    --with caddy-tilebounds=./caddy-tilebounds \
    --output /build/caddy-custom

# 运行阶段：精简镜像，只包含二进制、静态站点和配置
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/caddy-custom /usr/bin/caddy
COPY gdcm-map /srv/gdcm-map
COPY deploy/Caddyfile.docker /etc/caddy/Caddyfile

# 站点自身的 Caddyfile 已被容器专用版本覆盖，避免混淆
RUN rm -f /srv/gdcm-map/Caddyfile

WORKDIR /srv/gdcm-map
EXPOSE 80

ENTRYPOINT ["/usr/bin/caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
