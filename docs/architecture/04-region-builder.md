# Region Builder

The C++20 `roam-packager` is the authoritative POI pipeline:

```text
OSM PBF -> libosmium -> GeoJSON POIs -> uniform-grid index
```

The JavaScript tooling under `tools/region-builder` is retained only for the
separate PMTiles/map pipeline and compatibility with older packages.
