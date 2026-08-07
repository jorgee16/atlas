# Offline Regions

`public/regions/catalog.json` is the single runtime catalogue. A catalogue
entry can provide:

- `pois.geojson` for local places.
- `poi-index.json` for uniform-grid nearby search.
- An optional `map.pmtiles` vector basemap.

Bundled regions are searchable immediately. Downloadable regions become
searchable after their assets are cached and recorded by `RegionInstallStore`.

Portugal is bundled and covers the mainland, Madeira, and the Azores using
three separate `areas` bounds. London remains bundled. Lisbon is not a
separate region because it is covered by Portugal.

On every region transition, `MapController` passes the active region to the
map adapter. The online OpenStreetMap layer remains the default. If the active
region has an available PMTiles archive, the adapter adds it to the layer
selector as an offline alternative.
