# Atlas native migration

Branch: `migration/native-core-kotlin`.

This branch introduces a C++17 offline engine and an Android frontend written in
Kotlin. It is an **in-progress migration**, not a claim of complete feature or
visual parity with the web app. The native app has its own Android module and
application ID so both versions can be installed during validation.

## Build

Requirements: JDK 21, Android SDK 36, NDK 27.2.12479018, CMake 3.22.1.

```sh
cd android
./gradlew -PnativeOnly :native-app:assembleDebug :native-app:lintDebug
```

Output: `android/native-app/build/outputs/apk/debug/native-app-debug.apk`.

`-PnativeOnly` excludes the Capacitor modules from Gradle configuration. It does
not require `npm install` or a generated web bundle. Open `android/` in Android
Studio and pass this property when working exclusively on the native module.

The `Native C++ and Kotlin Android` GitHub Actions workflow builds the native
engine, checks it against JavaScript fixtures, builds/lints the APK, and uploads
`Atlas-native-debug-apk` after a successful build.

## Engine boundaries

- `native/include/atlas/core.hpp`: platform-independent public C++ API.
- `native/src/binary.cpp`: RAII-owned read-only memory maps, endian-safe bounded
  binary access, coordinates, and UTF-8 JSON output.
- `native/src/routing.cpp`: graph v6 reader, profile-aware road snapping,
  restricted-turn A*, geometry restoration, toll avoidance and estimates.
- `native/src/search.cpp`: ATSI v2 + ATSR v1 readers, accent-insensitive text
  search, prefix completion, address-index support, and nearby/category search.
- `native/src/guidance.cpp`: maneuvers, roundabout exit counting, projection,
  route progress, arrival, GPS confidence and sustained-deviation rerouting.
- `native/src/jni.cpp`: guarded engine handles, exception translation, UTF-8
  result byte arrays, and atomic route cancellation.
- `android/native-app`: Kotlin UI, Android lifecycle, native worker, platform
  location/TTS/network/storage adapters, and MapLibre Native maps.

There is no remote application server in this design. The backend is a local
library inside the APK. Offline search and road routing run on the device.
Kotlin adapters own Android I/O and system APIs. The native module has no
Capacitor, Leaflet, JavaScript runtime, or WebView dependency.

## Data compatibility

Native routing reads the same seven graph v6 files as the web app. Native
search reads the existing generated `search-index.bin`/`search-records.bin`
and optional `address-index.bin`/`address-records.bin` files. Old ATSI v1/JSON
search packages must be rebuilt or updated; they are rejected, not misread.

The bundled public region catalog is copied from `public/regions/catalog.json`.
After changing the catalog, update the copy in the native module. Data is
fetched from the same asset origin as the current native Capacitor app.
Downloads are user initiated, streamed to staging, checked against declared
sizes and SHA-256, and activated with a version marker only after success.
Failed or cancelled downloads preserve the previously installed version.

MapLibre Native reads local `pmtiles://file://` vector sources. The current
catalog contains a London PMTiles asset; Portugal currently has routing/search
assets but no declared map archive. Regions without a local archive use online
OpenStreetMap tiles. This does not imply offline basemap coverage for Portugal.
MapLibre documentation: https://maplibre.org/maplibre-native/android/examples/data/PMTiles/

Personal itineraries are imported through Android's document picker. No travel
itinerary is bundled in this module. The new application ID also means existing
WebView local storage is not automatically accessible: bookmarks, downloaded
regions, preferences and imported trips are separate during migration.

## Validation

```sh
node native/tests/generate-fixtures.mjs /tmp/atlas-native-fixtures
cmake -S native -B /tmp/atlas-build -DCMAKE_BUILD_TYPE=Debug
cmake --build /tmp/atlas-build -j2
ctest --test-dir /tmp/atlas-build --output-on-failure
python3 native/tests/compare-routes.py /tmp/atlas-native-fixtures /tmp/atlas-build/atlas_route
```

The fixture generator uses the existing packager and graph fixture writer;
the comparison obtains expected paths directly from the existing JS router.
There are 24 drive/walk/toll/access/restriction path comparisons. Native tests
also exercise snapping, directed/disconnected topology, cancellation, invalid
binary offsets, accent folding, prefix matching, nearby geography exclusion,
route projection, GPS uncertainty, sustained off-route confidence and arrival.

The desktop CLI can inspect an installed graph:

```sh
/tmp/atlas-build/atlas_route /path/to/routing 0 42 drive avoid-tolls
```

The original `npm test` and `npm run build` remain available for regression
checks against the retained web app. Passing these tests does not validate the
native UI or establish equivalence on full production regional datasets.

## Remaining work before replacing the current app

| Area | Implemented | Still required for full parity |
| --- | --- | --- |
| Offline routing | C++ graph v6, fastest car/walk paths, turn restrictions, geometry, toll avoidance | Production dataset benchmarks, route alternatives and vehicle/toll preference UI |
| Search | C++ indexed POI/address lookup, accent folding, final-token prefix, nearby categories | Match the full existing ranking/postcode/alias policy, spatial nearby index and routing-road compatibility fallback |
| Guidance | Native maneuvers, progress, confidence, arrival and reroute decisions; Kotlin TTS | Match lane guidance, advanced junction rendering, driving-camera details, GPS motion-noise model and route-undo behavior |
| Maps | Native MapLibre, online raster and local PMTiles, route and destination overlays | Full existing visual design, offline labels/fonts/sprites, travelled-route styling and map-native alternative selection |
| Trips | JSON import, validation, persistent trip list, day/place selection | Complete itinerary execution, visited-state progression, thumbnails and transit handoffs |
| Transit | Kotlin TfL journey requests, alternatives and leg instructions | Port journey ranking, detailed execution state, live arrivals and sibling-stop filtering |
| Regions | Download/update/remove/cancel, versioned activation, checksums | Restart-resumable background work, richer storage UI, automatic catalog refresh, full-size package tests |
| User data | Native bookmarks, trips and preferences | Explicit migration/export/import of existing WebView storage |
| Platforms | Android arm64/x86_64 native app; portable C++ engine | Kotlin desktop frontend if desktop is required; browser frontend remains JavaScript |
| Tooling | Existing C++ OSM packager retained; native CI added | Region normalization/index-building scripts remain Node.js and have not been ported |

No real-device or emulator visual/navigation acceptance testing has yet been
performed in this environment. Complete those checks before promoting this
branch or replacing the current Android application.
