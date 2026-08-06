# Offline Maps

## Phase 4.2 — Map package generation

Roam region packages can include a vector map archive:

    public/regions/<region-id>/
    ├── metadata.json
    ├── pois.geojson
    ├── poi-index.json
    └── map.pmtiles

`map.pmtiles` is generated from OpenStreetMap data with Tilemaker.

Phase 4.2 generates and validates the archive but does not yet change
the application map renderer. Integration with the map adapter is a
separate step.
