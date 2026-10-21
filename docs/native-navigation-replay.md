# Android camera and GPS validation

Every push to `migration/native-core-kotlin` runs Kotlin/C++ unit tests, lint,
builds an installable APK and executes existing Android tests plus the focused
`cameraModesAndStationaryWalkingThroughAndroidLocation` emulator test.
The focused test uses the real Portugal graph/PMTiles and Android mock Location,
JNI and MapLibre; it is not a fake routing fixture. It checks actual Overview and
Recenter UI touches with a guidance update between touch down/up, rapid mode
alternation, source/style reloads, pan/zoom, detached GPS updates, Activity
recreation, degraded accuracy, stationary pedestrian jitter and walking resumption.
Camera state and screenshots prove bounds, zero overview bearing/tilt, follow
padding, and restoration without another GPS fix.

The complete `portugalTripThroughAndroidLocationServiceJniAndMapLibre` replay is
retained for release validation. Run the workflow manually with `full_gps_replay`
selected, or push a validation commit containing `[full-gps-replay]`. Ordinary
minor UI commits do not run the full trip. A validation run executes both
focused and full tests for the same commit. Full mode covers roundabouts,
intentional deviation/rerouting, 1 Hz driving/walking, GNSS inversions, GPS gaps
of 2/5/9 seconds and native arrival.

CI uses Java 21, SDK/Build Tools 36, NDK 27.2.12479018, CMake 3.22.1 and an API 35
x86_64 Pixel 2 emulator with software GPU. `prepare-native-gps-replay.py` verifies
real mainland Portugal routing and PMTiles length/SHA-256. The repository's
existing R2 identity may read the same assets if public HTTP fails. No writes
are performed. POI/address package installation is outside this replay's scope.

Evidence in `Atlas-native-ui-review`:

- `camera-smoke/`: focused frame/fix/event logs, screenshots and summary.
- `atlas-camera-smoke/segment-*.mp4`: focused camera transition recordings.
- `Atlas-native-full-gps-review`: full-trip `gps-replay/` and
  `atlas-gps-replay/` metrics/screenshots/videos from the parallel replay job.
- `gps-replay-input/routing-manifest.json`: actual installed asset hashes.
- Android/JVM reports, lint and device logcat.

`Atlas-native-debug-apk` is the APK for that exact workflow SHA. Check job
results and numerical/visual evidence before describing it as validated.
The full analyzer checks bounded cursor/camera steps, continuous rendering,
heading-up cursor alignment and camera heading against independent replay truth.
The stationary assertion remains under one metre. Both modes require decodable
video covering the test. Original recordings and full-resolution PNGs remain in
artifacts; small preview JPEGs are also emitted in logs for connector-only review.

Camera ownership is explicit: FOLLOWING, OVERVIEW or FREE. A versioned pending
request survives style/layout readiness and only the newest request can be
acknowledged. Style changes rebuild annotations without resetting motion filters.
Navigation mode transitions use immediate camera transactions with explicit
padding; the render loop moves the camera only in FOLLOWING. Gesture callbacks
enter FREE directly, without delayed camera-start notifications. Navigation UI
updates defer rebuilding pressed controls until touch up/cancel.

Mock GPS tests do not replace real-device/GNSS hardware validation or exhaustive
intersection and multipath coverage. Online imagery needs its external provider.

## Temporal recovery and diagnostics

Ordinary JNI projections retain the shared presentation budget; they never reset
it to catch up. Start and foreground return are explicit visual epochs using a
fresh observed fix. Predictions are marked separately by `predictedAt` and
`predictionBaseAlong`, and cannot use a projection from a different GPS timestamp.
Gap targets retain the observed motion speed for correction while disabling any
second extrapolation. Native reachability budgets use the timestamp/speed of the
last reliable projection, rather than the timestamp of a later rejected fix.

The full replay now stops at the next input/wait when a recorded frame exceeds
the unchanged six-metre step gate, retaining both frames in
`trajectory-failure.json`. The post-run gates remain mandatory. Frame diagnostics
include observed GPS, matching timestamp/coordinates, confirmed progress,
rendered position, prediction timestamp and foreground synchronization state.

`ATLAS_REPLAY_TIMINGS` reports the measured input span, nominal 1.02-second input
cadence, actual delivery intervals, screenshot time and route/startup setup time.
About 600 fixes alone require about ten minutes of real-time playback; GPS-loss
scenarios, screenshots, native route setup and software-renderer/instrumentation
overhead account for the rest. Normal pushes retain the focused replay; full
travel remains compulsory for publication via `[atlas-release]`.


## Keeping iteration fast

Gradle dependency caches and task-output caching are enabled for Android smoke,
full replay and signed Release builds. The migration branch can write its own
cache; pull requests only read it. Node parity/transit jobs reuse the npm cache.
The first run populates these caches; savings must be measured on later runs.

Confirmed camera reversals now fail during playback, using the final analyzer's
unchanged eligibility: following/heading-up, speed >= 1.2 m/s, accuracy <= 20 m,
bearing accuracy <= 15 degrees, truth stable for >= 4 seconds, and truth fix age
in [0, 1.5) seconds. An error >= 100 degrees records the exact frame in
`trajectory-failure.json` and aborts at the next input/wait. Sharp turns, stale
fixes and poor GNSS do not trigger this gate. Boundary/eligibility tests run in
the ordinary Android instrumentation suite; final artifact analysis still runs.

Fast Android smoke and the full trip already run as separate parallel jobs.
Full trips are requested explicitly or required for publication, not for ordinary
small changes. No GPS timestamps, 1 Hz waits, route coverage or assertion limits
are reduced to improve CI duration. Successful full trips still take real time;
this change reduces repeated setup and time wasted after a known failure.
