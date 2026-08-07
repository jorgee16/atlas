# PMTiles Rendering

Phase 4.3 adds a local vector-map layer to the existing Leaflet adapter.

Dependency direction:

    Application
        |
        v
    MapController
        |
        v
    LeafletMapAdapter
        |
        +-- Online OSM layer
        |
        +-- PMTiles vector layer

PMTiles-specific archive handling is isolated in:

    src/map/layers/pmtiles-vector-layer.js

The adapter starts with the online OpenStreetMap layer, checks whether the
configured PMTiles archive is available, registers it in the layer control,
and selects it when `preferOffline` is enabled.

OpenStreetMap attribution remains visible for both map sources.
