# Map Engine

## Phase 4.1 — Map abstraction

Phase 4.1 separates Roam's map operations from Leaflet.

The application depends on `MapController`, while Leaflet-specific code
lives in `LeafletMapAdapter`.

```text
App / Itinerary / GPS
          |
          v
    MapController
          |
          v
  LeafletMapAdapter
          |
          v
       Leaflet
```

`MapController` exposes:

- `showItinerary`
- `clearItinerary`
- `addNearby`
- `clearNearby`
- `updateUserLocation`
- `focus`
- `invalidateSize`

The rest of the application does not access Leaflet objects directly.

This allows a future PMTiles-capable adapter or map layer provider to be
added without changing itinerary, GPS, nearby search, or UI modules.
