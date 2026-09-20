// Package caddytilebounds implements a Caddy HTTP handler that inspects
// Google Maps satellite/road tile requests (the "pb" query parameter
// encodes zoom/x/y tile indices) and rejects any tile whose geographic
// footprint falls entirely outside a configured lat/lng bounding box.
// This enforces the area restriction at the reverse-proxy layer itself,
// not just in client-side JS (which a user could bypass).
package caddytilebounds

import (
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strconv"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func init() {
	caddy.RegisterModule(TileBounds{})
	httpcaddyfile.RegisterHandlerDirective("tile_bounds", parseCaddyfile)
}

// TileBounds is a Caddy HTTP middleware that restricts Google Maps tile
// requests to a configured geographic bounding box.
type TileBounds struct {
	MinLat float64 `json:"min_lat,omitempty"`
	MaxLat float64 `json:"max_lat,omitempty"`
	MinLng float64 `json:"min_lng,omitempty"`
	MaxLng float64 `json:"max_lng,omitempty"`
}

// CaddyModule returns the Caddy module information.
func (TileBounds) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.tile_bounds",
		New: func() caddy.Module { return new(TileBounds) },
	}
}

// pbRe extracts the zoom (z), tile-x, tile-y indices embedded in Google's
// "pb" query parameter (used by vector-map tile requests), e.g.
// "!1i18!2i215835!3i99332!4i256".
var pbRe = regexp.MustCompile(`!1i(\d+)!2i(\d+)!3i(\d+)`)

// vtPathRe matches known Google Maps tile-serving paths so we can tell
// "this is a map tile request" apart from other API calls (JS bootstrap,
// RPC metadata calls, fonts, etc.) that should not be bounds-checked.
var vtPathRe = regexp.MustCompile(`/vt(/|$)`)

// ServeHTTP implements caddyhttp.MiddlewareHandler.
func (t TileBounds) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	if vtPathRe.MatchString(r.URL.Path) {
		z, x, y, ok := extractTileCoords(r)
		if !ok {
			// 无法从请求中识别出瓦片坐标（例如遇到未知/新的 URL 参数格式）时，
			// 采用"识别不出就拒绝"的保守策略（fail-closed），而不是放行——
			// 否则任何未覆盖到的 URL 变体都会成为绕过区域限制的漏洞。
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("tile coordinates could not be verified"))
			return nil
		}
		tLatMin, tLatMax, tLngMin, tLngMax := tileBounds(z, x, y)
		// 必须要求瓦片完全落在允许区域内才放行。若只判断"有重叠"，当地图被
		// 缩小到很低的缩放级别时，单张瓦片会覆盖极大的地理范围（可能同时覆盖
		// 允许区域和地球另一端），"有重叠"即会误判通过。改为"完全包含"后，
		// 任何跨出允许区域边界的瓦片都会被拒绝。
		if !fullyWithin(tLatMin, tLatMax, tLngMin, tLngMax, t.MinLat, t.MaxLat, t.MinLng, t.MaxLng) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte("tile outside allowed region"))
			return nil
		}
	}
	return next.ServeHTTP(w, r)
}

// extractTileCoords tries several known Google Maps tile URL conventions to
// pull out the (z, x, y) slippy-map tile indices:
//  1. Vector tiles: "pb" query param containing "!1i<z>!2i<x>!3i<y>".
//  2. Classic raster tiles: plain "x", "y", "z" query parameters
//     (e.g. ".../vt/lyrs=s?x=103&y=55&z=7&scale=2").
func extractTileCoords(r *http.Request) (z, x, y int, ok bool) {
	q := r.URL.Query()

	if pb := q.Get("pb"); pb != "" {
		if m := pbRe.FindStringSubmatch(pb); m != nil {
			z, e1 := strconv.Atoi(m[1])
			x, e2 := strconv.Atoi(m[2])
			y, e3 := strconv.Atoi(m[3])
			if e1 == nil && e2 == nil && e3 == nil {
				return z, x, y, true
			}
		}
	}

	xs, ys, zs := q.Get("x"), q.Get("y"), q.Get("z")
	if xs != "" && ys != "" && zs != "" {
		xi, e1 := strconv.Atoi(xs)
		yi, e2 := strconv.Atoi(ys)
		zi, e3 := strconv.Atoi(zs)
		if e1 == nil && e2 == nil && e3 == nil {
			return zi, xi, yi, true
		}
	}

	return 0, 0, 0, false
}

// tileBounds converts standard slippy-map tile indices (z, x, y) into the
// lat/lng bounding box that tile covers (Web Mercator projection).
func tileBounds(z, x, y int) (latMin, latMax, lngMin, lngMax float64) {
	n := math.Pow(2, float64(z))
	lngMin = float64(x)/n*360 - 180
	lngMax = float64(x+1)/n*360 - 180
	latMax = mercatorTileLat(float64(y), n)
	latMin = mercatorTileLat(float64(y+1), n)
	return
}

func mercatorTileLat(y, n float64) float64 {
	rad := math.Atan(math.Sinh(math.Pi * (1 - 2*y/n)))
	return rad * 180 / math.Pi
}

// fullyWithin reports whether the tile's bounding box is entirely contained
// within the allowed region's bounding box (not merely overlapping it).
func fullyWithin(latMin, latMax, lngMin, lngMax, allowMinLat, allowMaxLat, allowMinLng, allowMaxLng float64) bool {
	return latMin >= allowMinLat && latMax <= allowMaxLat && lngMin >= allowMinLng && lngMax <= allowMaxLng
}

// UnmarshalCaddyfile sets up the handler from Caddyfile tokens:
//
//	tile_bounds {
//		min_lat <float>
//		max_lat <float>
//		min_lng <float>
//		max_lng <float>
//	}
func (t *TileBounds) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			key := d.Val()
			var val string
			if !d.NextArg() {
				return d.ArgErr()
			}
			val = d.Val()
			f, err := strconv.ParseFloat(val, 64)
			if err != nil {
				return fmt.Errorf("invalid float for %s: %v", key, err)
			}
			switch key {
			case "min_lat":
				t.MinLat = f
			case "max_lat":
				t.MaxLat = f
			case "min_lng":
				t.MinLng = f
			case "max_lng":
				t.MaxLng = f
			default:
				return d.Errf("unrecognized subdirective '%s'", key)
			}
		}
	}
	return nil
}

func parseCaddyfile(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var t TileBounds
	err := t.UnmarshalCaddyfile(h.Dispenser)
	return t, err
}

// Interface guards.
var (
	_ caddyhttp.MiddlewareHandler = (*TileBounds)(nil)
	_ caddyfile.Unmarshaler       = (*TileBounds)(nil)
)
