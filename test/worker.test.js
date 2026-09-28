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
