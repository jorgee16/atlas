# Offline Regions

`public/regions/catalog.json` is the single runtime catalogue. A catalogue
entry can provide:

- `pois.geojson` for local places.
- `poi-index.json` for uniform-grid nearby search.
- An optional `map.pmtiles` vector basemap.
- Optional `routing/*.bin` assets for offline car routing.
- A package `version`, measured `sizeBytes`, and optional per-file SHA-256
  manifest.

## Installation lifecycle

Large regions are never downloaded automatically. The region manager lists
published packages, displays their map/place/navigation components, reports
device storage, and lets the user download, cancel, update, retry, or remove a
region.

Each download is written to a new region-specific Cache Storage namespace. The
previous version remains available until every new file has completed and any
declared checksum has passed. Only then does `RegionInstallStore` atomically
record the new version and remove earlier managed caches. A cancelled or failed
download deletes its partial cache.

The install record contains the package version, measured bytes, file count,
verification count, cache name, and install/update timestamps. Legacy v1
records are recognized and shown as requiring an update because they did not
store a package version.

`RegionRepository` exposes only bundled packages or downloads whose installed
version exactly matches the catalogue. This prevents POI search or routing from
mixing incompatible files after a format change.

## Selection and geographic coverage

Portugal covers the mainland, Madeira, and the Azores using three separate
`areas` bounds. London is a single region. Lisbon is not a separate region
because it is covered by Portugal.

GPS asks `RegionManager` for the region containing the current position. An
installed matching package activates automatically. An available or outdated
package is shown as `Near you`, but Atlas only downloads it after explicit user
action. Installing or removing the current region immediately refreshes map
selection without waiting for another GPS fix.

Routing endpoints must be covered by the same installed region. Portugal uses
one package for the mainland, Madeira, and the Azores; component IDs make an
impossible route between disconnected islands fail before A* traverses the
graph.
