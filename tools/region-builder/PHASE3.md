# Phase 3: Uniform spatial grid

The region builder now generates:

```text
public/regions/<region>/
├── metadata.json
├── pois.geojson
└── poi-index.json
```

`poi-index.json` maps geographic grid cells to POI array indexes.

The browser loads the region once, identifies the cells intersecting the
requested search radius, and computes exact distances only for POIs in
those cells.
