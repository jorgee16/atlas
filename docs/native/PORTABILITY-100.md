# Atlas native 100% portability contract

Target: full user-visible and behavioral parity with the current Atlas web/Capacitor application, using Kotlin Android UI and a C++ native core. This is an acceptance contract, not a claim that migration is complete.

## Hard requirements

- Android app runs without a WebView, Leaflet, Capacitor, or a JavaScript runtime in production. Preserve the original app on `main` during migration.
- Native MapLibre rendering: online and offline maps, route preview, camera following, zoom, heading, route highlighting and map interaction.
- C++ routing: matching the current route graphs and package formats, driving/walking profiles, restrictions, tolls, alternatives, rerouting and ETA behavior.
- C++ search: POI, addresses, aliases, postcodes, categories, nearby results, ranking, low-latency completion and offline operation.
- Kotlin/Android navigation: trip planning, route choices, speech, lane/roundabout/junction cues, GPS smoothing, tunnel/dead-reckoning behavior, route locking under uncertainty, confirmed divergence and recovery without visual flashes.
- Trips: imports, schedules, day/stop management, saved destinations, visited state, navigation handoff and persistence.
- Transit: live information, multi-leg trips, disruption handling, ranking and stop filtering available in the existing app.
- Regional packages: catalog, streaming download, integrity checking, updates, cancellation, resumable downloads, activation, deletion and complete offline map assets (including glyphs/fonts/sprites where applicable).
- Existing-user migration: transfer saved places, preferences, trips and region state from the existing Android installation, with a tested rollback path.
- Lifecycle: foreground/background location, return to navigation, orientation, theme switch, process recreation, permissions, audio focus, battery behavior and Android platform compliance.
- Native production app and reproducible APK builds delivered through GitHub Actions, including signed-release readiness.
- Build-time region data tooling must not require Node.js if the promise includes 100% repository/toolchain portability; otherwise track it explicitly as an exception.

## Definition of done

1. Create a feature inventory against the existing `main` app; each feature gets an owning native implementation and automated/manual acceptance tests.
2. Compare native routing, search, progress and navigation outputs against production Portugal datasets and representative GPS recordings, not only synthetic fixtures.
3. Pass C++ unit/sanitizer tests and Android unit/instrumented tests; run real-device driving and walking acceptance (including tunnels, background return, theme/rotation and loss of GPS).
4. Verify install/upgrade and user-data migration without losing pre-existing data.
5. Verify actual offline operation with networking disabled across at least one complete supported region.
6. Only then label the Kotlin/C++ implementation 100% portable and promote it for replacement of the current app.

## Current blockers (as documented in docs/native/README.md)

Production data benchmarks, complete search ranking, advanced navigation/GPS parity, map assets and junction rendering, transit parity, resumable region downloads, existing storage migration and Node.js tooling migration are not yet signed off.

No partial implementation, build success, or screenshots alone satisfies this contract.
