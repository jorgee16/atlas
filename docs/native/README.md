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
- `native/src/motion.cpp`: displacement-confirmed motion/speed, circular heading
  fusion and conservative drive ETA calibration.
- `native/src/jni.cpp`: guarded engine handles, exception translation, UTF-8
  result byte arrays, and atomic route cancellation.
- `android/native-app`: Kotlin UI, Android lifecycle, native worker, platform
  location/TTS/network/storage adapters, and MapLibre Native maps.

There is no remote application server in this design. The backend is a local
library inside the APK. Offline search and road routing run on the device.
Kotlin adapters own Android I/O and system APIs. The native module has no
Capacitor, Leaflet, JavaScript runtime, or WebView dependency.

## Native interface

The native app uses a shared design system in `AtlasUi.kt`, map/layer lifecycle
in `AtlasMap.kt`, screen content in `AtlasPages.kt`, and activity composition in
`MainActivity.kt`. All product controls are native Android views with consistent
spacing, typography, stroke icons, rounded surfaces, selected states and touch
targets. No WebView is used.

- Explore: floating search, nearby categories, compact two-result peek, saved
  places, map controls and a dedicated full results page.
- Navigation: compact origin/destination planning, drive/walk/transit modes,
  toll preferences, computed toll-free alternatives, map selection, progressive
  route-preview collapse and an always-reachable Start action.
- Guidance: maneuver banner, conditional lane hints, GPS-confidence notices,
  ETA/duration/distance summary, route overview, voice and confirmed End action.
- Trips: JSON imports, multiple itineraries, day selection, optional thumbnails,
  persistent visited-state tracking, next-stop navigation and trip deletion.
- Regions: installed/update states, package sizes, progress, cancellation,
  retry/error presentation and confirmed removal.
- Settings: light/dark/system appearance, voice and vehicle class.
- Transit: journey options and per-leg execution with disruption descriptions.

Android instrumented tests capture representative portrait, landscape and dark
screens into the `Atlas-native-ui-review` CI artifact. The itinerary and route
used by these visual tests are synthetic fixtures confined to `androidTest`;
they are not bundled in the application APK.

## Data compatibility

Native routing reads the same seven graph v6 files as the web app. Native
search reads the existing generated `search-index.bin`/`search-records.bin`
and optional `address-index.bin`/`address-records.bin` files. Old ATSI v1/JSON
search packages must be rebuilt or updated; they are rejected, not misread.

The bundled public region catalog is copied from `public/regions/catalog.json`.
After changing the catalog, update the copy in the native module. Data is
fetched from the same asset origin as the current native Capacitor app.
Downloads are user initiated, streamed to versioned staging, checked against
declared sizes and SHA-256, and activated with a version marker only after
success. Interrupted downloads retain the staged files and continue with
HTTP Range on retry. Existing partial bytes are re-hashed before resumption;
servers ignoring Range trigger a safe restart. Failed downloads preserve
both already downloaded files and the previously installed region version.
Staging is removed on explicit region deletion or after the successful update.
The app checks a bounded HTTPS R2 catalog on foreground entry (rate-limited
to once per 15 minutes), caches it atomically, and exposes a manual refresh.
The remote catalog must preserve all previously advertised regions and cannot
downgrade package versions. A cache failure falls back to the bundled catalog.
Automated small-file Range tests exercise resume, restart and verified cache
reuse; the 960 MB Portugal production download still needs real-device tests.

MapLibre Native reads local `pmtiles://file://` vector sources. The
Portugal v9 region catalog now includes the 343,766,325-byte PMTiles v3
archive at `/region-packages/portugal/map.pmtiles` (mainland, Madeira and
Azores) in addition to the existing routing, POIs and search assets.
The Android bundled catalog and `public/regions/catalog.json` are kept in
sync. Portugal v8 installations must select **Update region** to download v9
before the local map is actually available. The map-ready indicator must be
based on the local PMTiles file, not merely the catalog declaration. The map source can be selected from the map badge, navigation controls, or Settings:
**Automatic** (prefer local PMTiles), **Online** (force network cartography
even if a local map is installed), or **Offline** (never fall back to network
map tiles). The setting persists across launches and does not change the offline
routing/search engine. Choosing Offline without a downloaded map directs users
to region downloads; crossing outside offline coverage shows an unavailable
basemap instead of silently using the internet. Offline font glyphs
are not yet bundled, so labels may still depend on network access.
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
route projection, GPS uncertainty, sustained off-route confidence, arrival,
motion-noise filtering, heading wraparound and ETA calibration.

The desktop CLI can inspect an installed graph:

```sh
/tmp/atlas-build/atlas_route /path/to/routing 0 42 drive avoid-tolls
```

The original `npm test` and `npm run build` remain available for regression
checks against the retained web app. Passing these tests does not validate the
native UI or establish equivalence on full production regional datasets.

## Navigation stability hardening

Navigation GPS and voice guidance now run in a location foreground service
with a persistent notification and an explicit End navigation action. An
Application-scoped native ViewModel keeps guidance state across activity
recreation and when other apps are in the foreground. The screen may stop
registering GPS while the service is active, avoiding competing listeners.
Force-stop, OS process death, device restart and post-reboot route restoration
are **not yet** handled; they remain acceptance gates. Android 14+ requires
location permission before starting the service.

The Kotlin GPS pipeline now uses a conflated channel rather than dropping
incoming fixes while native processing is in progress. Route/session generation
checks protect against a late JNI result resurfacing guidance or TTS after
stopping, changing a route or starting a reroute. Precise GPS is preferred to
network fixes during a brief overlap, while missing provider speed is passed
as missing data so the native motion filter can infer it from displacement.
MapLibre does not draw annotations into a style still loading. These are
implementation safeguards; road testing, Android background/foreground
location continuity and tunnel sensor fusion remain separate acceptance gates.

## Remaining work before replacing the current app

| Area | Implemented | Still required for full parity |
| --- | --- | --- |
| Offline routing | C++ graph v6, fastest car/walk paths, turn restrictions, geometry, toll avoidance | Production dataset benchmarks and broader route-alternative coverage |
| Search | C++ indexed POI/address lookup, accent folding, final-token prefix, nearby categories | Match the full existing ranking/postcode/alias policy, spatial nearby index and routing-road compatibility fallback |
| Guidance | Native maneuvers, progress, confidence, arrival and reroute decisions; background GPS/TTS, persistent interrupted destination and explicit replan on reopening | Road-tested tunnel continuity, match lane guidance, advanced junction rendering, driving-camera details, full GPS replay parity and route-undo behavior |
| Maps | Native MapLibre, styled online vector/raster and local PMTiles, travelled-route styling, native map controls and map alternative selection | Offline labels/fonts/sprites, full-size data performance and additional junction-map detail |
| Trips | JSON import, day/place selection, visited-state progression, optional thumbnails and next-stop actions | Full transit handoff and advanced itinerary scheduling parity |
| Transit | Kotlin TfL journey requests, alternatives, leg-by-leg execution and disruptions | Port advanced journey ranking, live arrivals and sibling-stop filtering |
| Regions | Download/update/remove/cancel, checksums, staged HTTP Range resumption, WorkManager background transfers, and remote catalog refresh | Full-size Portugal device tests, Android download foreground-service acceptance, and reliable storage-space reporting |
| User data | Native bookmarks, trips, preferences, JSON backup export and merge-import | Legacy WebView must first export an equivalent JSON file; direct access to another Android app's private storage is not available |
| Platforms | Android arm64/x86_64 native app; portable C++ engine | Kotlin desktop frontend if desktop is required; browser frontend remains JavaScript |
| Tooling | Existing C++ OSM packager retained; native CI added | Region normalization/index-building scripts remain Node.js and have not been ported |

No real-device or emulator visual/navigation acceptance testing has yet been
performed in this environment. Complete those checks before promoting this
branch or replacing the current Android application.


### One-commit parity work and remaining acceptance blockers

The new Navigation snapshot records the destination and driving preferences while
guidance is active. After a process restart the user is asked whether to
**recalculate from a fresh GPS fix**. Atlas never pretends the old JNI route,
position or progress has survived; it reconstructs routing from an installed
region. Android force-stop cannot be bypassed or auto-started.

Region transfers are scheduled as a user-initiated **WorkManager CoroutineWorker**
with network constraints, a persistent database work request and a data-sync
foreground notification. Transfers can resume after the process is reclaimed
using previously verified HTTP Range files. Device/OS-specific background
limits, notification behavior and one-gigabyte transfers still need testing.

Settings offer **Import Atlas backup** / **Export Atlas backup**. The import
merges rather than overwrites saved places and trips; it validates its JSON
schema. Existing WebView storage from a different app is sandboxed and cannot
be read automatically: export an Atlas-compatible backup from the old app first.
Direct legacy WebView-to-native migration is **not yet complete**.

Features **not complete in this batch**: full MapLibre offline glyph/sprite
assets, lane guidance/junction graphics, full legacy search ranking,
complex alternative routes, transport arrival parity, porting all Node-based
region-builder scripts, and road/Portugal-scale validation. Do not mark the
overall migration 100% until these have testable parity.
