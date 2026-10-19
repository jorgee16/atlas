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
minor UI commits do not run the 12-minute trip. A validation run executes both
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
- `gps-replay/` and `atlas-gps-replay/`: full-trip metrics/screenshots and videos
  when full validation is selected.
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
