# Offline Maps

## Offline map packages

Roam region packages can include a vector map archive:

    public/regions/<region-id>/
    ├── metadata.json
    ├── pois.geojson
    ├── poi-index.json
    └── map.pmtiles

`map.pmtiles` is generated from OpenStreetMap data with Tilemaker.

The active region is connected to the Leaflet adapter. Online OpenStreetMap is
the default layer. When the current catalogue entry defines `assets.map` and
the archive exists, Roam adds `Offline <region name>` to the layer selector.

Portugal currently provides offline POIs and a spatial index, but no PMTiles
archive. London keeps its optional PMTiles path. POI packages can be generated
with the C++ `roam-packager`; PMTiles generation remains in the map-tile
pipeline.
