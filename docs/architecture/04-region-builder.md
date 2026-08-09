# Region Builder

The C++20 `roam-packager` is the authoritative regional-data pipeline:

```text
OSM PBF -> libosmium -> GeoJSON POIs + compact car-routing graph
```

The routing pass reads routable `highway` ways, attaches node locations with
libosmium, applies access/one-way/maxspeed rules, and writes compact little-endian
binary assets:

- `nodes.bin`: contracted junction/endpoint coordinates and component IDs.
- `edges.bin`: CSR adjacency offsets and 20-byte directed travel-time edges,
  including a compact road-metadata reference;
  each edge references shared road geometry.
- `geometry.bin`: simplified intermediate road points shared by both travel
  directions.
- `spatial-index.bin`: a `0.005°` grid for endpoint snapping.
- `roads.bin` and `strings.bin`: deduplicated road names, references, sign
  destinations, link flags, and roundabout identities.
- `restrictions.bin`: via-node OSM car turn restrictions.

OSM shape points are not promoted to A* vertices. The extractor keeps way
endpoints, intersections, and a topology anchor at most every 200 metres, then
simplifies intermediate display geometry to a two-metre tolerance. This keeps
A* memory proportional to road topology while preserving the visible route.

The initial mobile car profile omits tracks, parking aisles, and individual
driveways. Normal service roads remain routable.

Portugal is emitted as `mainland`, `madeira`, and `azores` subgraphs plus a
manifest. This keeps individual assets smaller and lets the phone load only the
roads needed by the selected endpoints.

The JavaScript tooling under `tools/region-builder` is retained only for the
separate PMTiles/map pipeline and compatibility with older packages.
