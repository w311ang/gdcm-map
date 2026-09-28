const ALLOWED_BOUNDS = {
  minLat: 23.721844,
  maxLat: 23.762603,
  minLng: 113.07393,
  maxLng: 113.119559
};

const TILE_HOSTS = {
  khms0: "khms0.googleapis.com",
  khms1: "khms1.googleapis.com",
  khms2: "khms2.googleapis.com",
  khms3: "khms3.googleapis.com",
  mt0: "mt0.google.com",
  mt1: "mt1.google.com",
  mt2: "mt2.google.com",
  mt3: "mt3.google.com"
};

const PROXY_PREFIX_BY_HOST = {
  "maps.googleapis.com": "/gmaps-js",
  "maps.gstatic.com": "/gmaps-static",
  ...Object.fromEntries(
    Object.entries(TILE_HOSTS).map(([server, hostname]) => [
      hostname,
      `/gmaps-tile/${server}`
    ])
  )
};

// Maps JS 内部 gRPC-web 接口（如 GetViewportInfo 获取影像版权提供方）只接受 POST
const MAPS_RPC_PREFIX = "/gmaps-js/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/";

const TILE_COORDS_RE = /!1i(\d+)!2i(\d+)!3i(\d+)/;
const VECTOR_TILE_PATH_RE = /\/vt(?:\/|$)/;

export function parseTileCoordinates(url) {
  const params = url.searchParams;
  const pb = params.get("pb");
  if (pb) {
    const match = TILE_COORDS_RE.exec(pb);
    if (match) {
      return {
        z: Number(match[1]),
        x: Number(match[2]),
        y: Number(match[3])
      };
    }
  }

  const x = params.get("x");
  const y = params.get("y");
  const z = params.get("z");
  if (x !== null && y !== null && z !== null) {
    return { z: Number(z), x: Number(x), y: Number(y) };
  }
  return null;
}

export function tileBounds(z, x, y) {
  if (!Number.isInteger(z) || z < 0 || z > 30) return null;
  const tileCount = 2 ** z;
  if (!Number.isInteger(x) || !Number.isInteger(y) ||
      x < 0 || y < 0 || x >= tileCount || y >= tileCount) {
    return null;
  }

  const lngMin = (x / tileCount) * 360 - 180;
  const lngMax = ((x + 1) / tileCount) * 360 - 180;
  const mercatorLat = tileY => Math.atan(Math.sinh(Math.PI * (1 - 2 * tileY / tileCount))) * 180 / Math.PI;
  return {
    latMin: mercatorLat(y + 1),
    latMax: mercatorLat(y),
    lngMin,
    lngMax
  };
}

export function isTileAllowed(coords, bounds = ALLOWED_BOUNDS) {
  if (!coords) return false;
  const tile = tileBounds(coords.z, coords.x, coords.y);
  return tile !== null &&
    tile.latMin >= bounds.minLat &&
    tile.latMax <= bounds.maxLat &&
    tile.lngMin >= bounds.minLng &&
    tile.lngMax <= bounds.maxLng;
}

function getUpstream(url) {
  const { pathname } = url;

  if (pathname.startsWith("/gmaps-js/")) {
    return {
      hostname: "maps.googleapis.com",
      pathname: pathname.slice("/gmaps-js".length),
      isMapsJavaScript: true,
      isTile: VECTOR_TILE_PATH_RE.test(pathname)
    };
  }

  if (pathname.startsWith("/gmaps-static/")) {
    return {
      hostname: "maps.gstatic.com",
      pathname: pathname.slice("/gmaps-static".length),
      isMapsBootstrap: false
    };
  }

  const tilePrefix = "/gmaps-tile/";
  if (pathname.startsWith(tilePrefix)) {
    const remainder = pathname.slice(tilePrefix.length);
    const separator = remainder.indexOf("/");
    if (separator <= 0) return null;

    const tileServer = remainder.slice(0, separator);
    const hostname = TILE_HOSTS[tileServer];
    if (!hostname) return null;

    return {
      hostname,
      pathname: remainder.slice(separator),
      isMapsBootstrap: false,
      isTile: true
    };
  }

  return null;
}

function rewriteMapsBootstrap(text, origin) {
  return text.replace(
    /https?:\/\/([a-z0-9.-]+)/g,
    (url, hostname) => PROXY_PREFIX_BY_HOST[hostname]
      ? `${origin}${PROXY_PREFIX_BY_HOST[hostname]}`
      : url
  );
}

function forbidden(message) {
  return new Response(message, {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

export async function handleRequest(request, env, fetcher = fetch) {
  const requestUrl = new URL(request.url);
  const upstream = getUpstream(requestUrl);

  if (!upstream) {
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", { status: 404 });
  }

  const isMapsRpc = requestUrl.pathname.startsWith(MAPS_RPC_PREFIX);
  const allowedMethods = isMapsRpc ? ["POST"] : ["GET", "HEAD"];
  if (!allowedMethods.includes(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: { Allow: allowedMethods.join(", ") }
    });
  }

  if (upstream.isTile) {
    const coordinates = parseTileCoordinates(requestUrl);
    if (!isTileAllowed(coordinates)) {
      return forbidden(coordinates
        ? "tile outside allowed region"
        : "tile coordinates could not be verified");
    }
  }

  const upstreamUrl = new URL(`https://${upstream.hostname}`);
  upstreamUrl.pathname = upstream.pathname;
  upstreamUrl.search = requestUrl.search;
  // Google 最高支持 scale=4（1024px），统一请求最高清晰度
  if (upstream.isTile && upstreamUrl.searchParams.has("scale")) {
    upstreamUrl.searchParams.set("scale", "4");
  }

  if (upstream.hostname === "maps.googleapis.com") {
    if (!env.GOOGLE_MAPS_API_KEY) {
      console.error("GOOGLE_MAPS_API_KEY is not configured");
      return new Response("Google Maps proxy is not configured", { status: 500 });
    }
    upstreamUrl.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);
  }

  const headers = new Headers(request.headers);
  if (isMapsRpc) {
    // RPC 通过请求头携带 key，同样替换为服务端配置的 key
    headers.set("x-goog-api-key", env.GOOGLE_MAPS_API_KEY);
  }
  headers.delete("host");
  headers.delete("cookie");
  headers.delete("authorization");
  headers.delete("cf-connecting-ip");
  headers.delete("cf-ray");
  headers.delete("cf-worker");

  let upstreamResponse;
  try {
    upstreamResponse = await fetcher(upstreamUrl, {
      method: request.method,
      headers,
      body: isMapsRpc ? await request.arrayBuffer() : undefined,
      redirect: "follow"
    });
  } catch (error) {
    const errorType = error instanceof Error ? error.name : "unknown";
    console.error(`Google Maps upstream request failed (${errorType})`);
    return new Response("Google Maps upstream request failed", { status: 502 });
  }

  const contentType = upstreamResponse.headers.get("content-type") || "";
  if (!upstream.isMapsJavaScript ||
      !/^application\/(?:javascript|x-javascript)|^text\/javascript/i.test(contentType) ||
      request.method === "HEAD" ||
      !upstreamResponse.body) {
    return upstreamResponse;
  }

  const body = rewriteMapsBootstrap(await upstreamResponse.text(), requestUrl.origin);
  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("etag");

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  }
};
