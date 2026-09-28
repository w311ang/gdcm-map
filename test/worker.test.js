import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, isTileAllowed, parseTileCoordinates, tileBounds } from "../src/index.js";

function tileAt(lat, lng, zoom) {
  const tileCount = 2 ** zoom;
  const x = Math.floor((lng + 180) / 360 * tileCount);
  const latRadians = lat * Math.PI / 180;
  const y = Math.floor(
    (1 - Math.asinh(Math.tan(latRadians)) / Math.PI) / 2 * tileCount
  );
  return { z: zoom, x, y };
}

test("accepts a tile wholly inside the configured region", () => {
  const coords = tileAt(23.74, 113.1, 18);
  assert.equal(isTileAllowed(coords), true);
});

test("rejects a tile outside the configured region", () => {
  const coords = tileAt(39.9, 116.4, 18);
  assert.equal(isTileAllowed(coords), false);
});

test("rejects invalid and unrecognized tile coordinates", () => {
  assert.equal(tileBounds(31, 0, 0), null);
  assert.equal(tileBounds(4, 16, 0), null);
  assert.equal(isTileAllowed(null), false);
  assert.deepEqual(
    parseTileCoordinates(new URL("https://example.test/vt/?pb=unknown")),
    null
  );
});

test("blocks vector tile requests outside the allowed region before upstream fetch", async () => {
  let fetched = false;
  const response = await handleRequest(
    new Request("https://map.example/gmaps-tile/khms0/vt/?x=1&y=1&z=2"),
    {},
    async () => {
      fetched = true;
      return new Response("unexpected");
    }
  );

  assert.equal(response.status, 403);
  assert.equal(fetched, false);
});

test("blocks Maps API vector tiles outside the allowed region before upstream fetch", async () => {
  let fetched = false;
  const response = await handleRequest(
    new Request("https://map.example/gmaps-js/maps/vt/?x=1&y=1&z=2"),
    { GOOGLE_MAPS_API_KEY: "test-secret" },
    async () => {
      fetched = true;
      return new Response("unexpected");
    }
  );

  assert.equal(response.status, 403);
  assert.equal(fetched, false);
});

test("passes Maps API satellite tile bytes through unchanged", async () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const coords = tileAt(23.74, 113.1, 18);
  const response = await handleRequest(
    new Request(`https://map.example/gmaps-js/maps/vt/?x=${coords.x}&y=${coords.y}&z=${coords.z}`),
    { GOOGLE_MAPS_API_KEY: "test-secret" },
    async () => new Response(jpeg, {
      headers: { "Content-Type": "image/jpeg" }
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
});

test("requests satellite tiles upstream at scale=4", async () => {
  const coords = tileAt(23.74, 113.1, 18);
  const tileQuery = `x=${coords.x}&y=${coords.y}&z=${coords.z}`;
  const upstreamUrls = [];
  const fetcher = async (url) => {
    upstreamUrls.push(new URL(String(url)));
    return new Response("tile", { headers: { "Content-Type": "image/jpeg" } });
  };
  const env = { GOOGLE_MAPS_API_KEY: "test-secret" };

  await handleRequest(new Request(`https://map.example/gmaps-js/maps/vt/?${tileQuery}&scale=2`), env, fetcher);
  await handleRequest(new Request(`https://map.example/gmaps-js/maps/vt/?${tileQuery}`), env, fetcher);

  assert.equal(upstreamUrls[0].searchParams.get("scale"), "4");
  assert.equal(upstreamUrls[1].searchParams.has("scale"), false);
});

test("injects the Maps key upstream and rewrites bootstrap URLs", async () => {
  let requestedUrl;
  let upstreamHeaders;
  const response = await handleRequest(
    new Request("https://map.example/gmaps-js/maps/api/js?v=weekly&key=attacker", {
      headers: {
        Cookie: "session=private",
        Authorization: "Bearer private"
      }
    }),
    { GOOGLE_MAPS_API_KEY: "test-secret" },
    async (url, init) => {
      requestedUrl = new URL(url);
      upstreamHeaders = new Headers(init.headers);
      return new Response(
        'const a="https://maps.googleapis.com/maps/api/js";' +
        'const b="https://khms0.googleapis.com/vt/lyrs=s";',
        { headers: { "Content-Type": "application/javascript", "Content-Length": "1" } }
      );
    }
  );

  const body = await response.text();
  assert.equal(requestedUrl.searchParams.get("key"), "test-secret");
  assert.equal(upstreamHeaders.has("cookie"), false);
  assert.equal(upstreamHeaders.has("authorization"), false);
  assert.equal(body.includes("key=attacker"), false);
  assert.match(body, /https:\/\/map\.example\/gmaps-js\/maps\/api\/js/);
  assert.match(body, /https:\/\/map\.example\/gmaps-tile\/khms0\/vt\/lyrs=s/);
  assert.equal(response.headers.has("content-length"), false);
});

test("fails clearly if the Maps key is missing", async () => {
  const response = await handleRequest(
    new Request("https://map.example/gmaps-js/maps/api/js"),
    {},
    async () => assert.fail("must not call upstream without a configured key")
  );
  assert.equal(response.status, 500);
});

test("routes static content through the asset binding", async () => {
  let assetRequest;
  const response = await handleRequest(
    new Request("https://map.example/index.html"),
    {
      ASSETS: {
        fetch(request) {
          assetRequest = request;
          return new Response("static asset");
        }
      }
    }
  );
  assert.equal(await response.text(), "static asset");
  assert.equal(assetRequest.url, "https://map.example/index.html");
});

const RPC_PATH = "/gmaps-js/$rpc/google.internal.maps.mapsjs.v1.MapsJsInternalService/GetViewportInfo";

test("forwards Maps RPC POST with body and server-side key", async () => {
  let upstream;
  const response = await handleRequest(
    new Request(`https://map.example${RPC_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json+protobuf",
        "x-goog-api-key": "attacker",
        cookie: "session=secret"
      },
      body: "[[1,2]]"
    }),
    { GOOGLE_MAPS_API_KEY: "server-key" },
    async (url, init) => {
      upstream = { url: String(url), init, body: new TextDecoder().decode(init.body) };
      return new Response("[]", { headers: { "content-type": "application/json+protobuf" } });
    }
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "[]");
  assert.equal(upstream.init.method, "POST");
  assert.equal(upstream.body, "[[1,2]]");
  assert.equal(upstream.init.headers.get("x-goog-api-key"), "server-key");
  assert.equal(upstream.init.headers.get("cookie"), null);
  const url = new URL(upstream.url);
  assert.equal(url.hostname, "maps.googleapis.com");
  assert.equal(url.pathname, RPC_PATH.slice("/gmaps-js".length));
  assert.equal(url.searchParams.get("key"), "server-key");
});

test("only allows POST on the Maps RPC path and GET/HEAD elsewhere", async () => {
  const env = { GOOGLE_MAPS_API_KEY: "server-key" };
  const neverFetch = async () => assert.fail("must not reach upstream");

  const rpcGet = await handleRequest(new Request(`https://map.example${RPC_PATH}`), env, neverFetch);
  assert.equal(rpcGet.status, 405);
  assert.equal(rpcGet.headers.get("allow"), "POST");

  const otherPost = await handleRequest(
    new Request("https://map.example/gmaps-js/maps/api/js", { method: "POST", body: "x" }),
    env,
    neverFetch
  );
  assert.equal(otherPost.status, 405);
  assert.equal(otherPost.headers.get("allow"), "GET, HEAD");

  const otherRpcService = await handleRequest(
    new Request("https://map.example/gmaps-js/$rpc/google.internal.other.Service/Method", { method: "POST", body: "x" }),
    env,
    neverFetch
  );
  assert.equal(otherRpcService.status, 405);
});
