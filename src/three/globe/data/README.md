# Globe land data — `land-110m.json`

## Source

- **Dataset:** Natural Earth — **1:110m Physical / Land** (`ne_110m_land`)
- **Origin file:** `geojson/ne_110m_land.geojson`
- **Downloaded from:** the Natural Earth vector mirror
  `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson`
  (official upstream: <https://www.naturalearthdata.com/>)
- **Retrieved:** 2026-07-22 (during development only)

## License / rights

Natural Earth is **public domain**. From the Natural Earth terms of use:

> All versions of Natural Earth raster + vector map data found on this website
> are in the public domain. You may use the maps in any manner, including
> modifying the content and design, electronic dissemination, and offset
> printing. No permission is needed to use Natural Earth. Crediting the authors
> is unnecessary.

No attribution is required; there is no per-use restriction.

## Preprocessing applied (dev-time, no runtime deps)

The upstream GeoJSON (~138 KB) was reduced to a lean, self-contained asset:

- Stripped `crs`, per-feature `properties`, and per-feature `bbox`.
- Rounded all coordinates to **2 decimal places** (~1.1 km at the equator —
  far finer than the source's own ~110 km / 1:110m generalization, so no
  visible coastline detail is lost; North & South America remain clearly
  recognizable).
- Removed consecutive duplicate vertices introduced by rounding and re-closed
  each ring.

Result: **127 land polygons, 128 rings, ~5,129 coordinates, ~84 KB raw
(~27 KB gzipped)**. Structure is a standard GeoJSON `FeatureCollection` of
`Polygon` features (`coordinates` are `[lng, lat]` rings, exterior ring first).

The processing was done with Node's built-in JSON tooling only — **no npm
dependency was added** to fetch or transform the data. The asset is imported at
build time from `src/three/globe/data/land-110m.json`; it is **never fetched at
runtime**, so it does not depend on any external network request or relax the
production Content-Security-Policy.
