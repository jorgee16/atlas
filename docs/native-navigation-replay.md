# Android navigation replay

The migration branch runs `Native C++ and Kotlin Android` on every push.
The Android job builds with Java 21, SDK/Build Tools 36, NDK 27.2.12479018
and CMake 3.22.1, then uses an API 35 x86_64 Pixel 2 emulator with software GPU.

`tools/prepare-native-gps-replay.py` downloads the real mainland Portugal
routing and PMTiles assets named in the bundled catalog and verifies both length and SHA-256.
A missing asset or a changed hash fails setup. Test installation includes routing and offline PMTiles; it must not be described
as validation of the complete POI or address package. Public HTTP failures are
recorded. If configured, the existing repository R2 identity reads the same
objects using S3 GET, with the same length and hash checks; it performs no writes. The generated manifest is saved with the evidence.

The existing UI and recreation tests run first. `NavigationGpsReplayTest` then
replaces only the Android GPS provider, using `LocationManager.setTestProviderLocation`.
It calls the public destination/calculation controls on the real model, without
replacing StateFlow, routes, guidance, matching or rerouting. Real C++/JNI routes
must contain graph edges. The driving route must contain a roundabout maneuver.
The background navigation service receives the mock Android Location callbacks,
which cross Kotlin, JNI motion/guidance, the production model and MapLibre.

The trip covers driving at approximately 1 Hz, noisy GNSS bearings, accuracy
5/20/35/60/100 m, 2/5/9 second GPS gaps, gesture pan and pinch zoom, each starting with follow active, and immediate recenter,
heading-up and north-up, Activity recreation and background GPS reception.
A deliberate deviation follows a separate route calculated from the same real
graph; Atlas must reroute to its unchanged destination. Walking uses another
real route and includes a stationary period with jitter and a compass animation without a new fix. Native arrival is required.

The test installs a debug-frame callback only for the replay. Production frames
perform no diagnostic serialization, logging or disk writes. The callback
records render cadence, GPS timestamp/quality, speed, provider/native heading and independent replay-truth heading,
guidance state/progress/segment, tunnel prediction, rendered position, camera
center/bearing, cursor bearing, raw/filtered speed and follow state.

Evidence is uploaded in `Atlas-native-ui-review`:

- `gps-replay/frames.ndjson` and `fixes.ndjson`: actual observed monotonic times.
- `gps-replay/*route.json`: real native routes, including the recalculation.
- `gps-replay/*.png` and matching JSON: visual checkpoints and camera state.
- `gps-replay/logcat.txt`: Android and native diagnostics, including failures.
- `atlas-gps-replay/segment-*.mp4`: continuous rotating three-minute recordings.
- `gps-replay/summary.json`: automated analysis, emitted only after the test passes.
- `gps-replay-input/routing-manifest.json`: input asset sizes and SHA-256 values.
- Android instrumented-test reports and the existing UI review evidence.

`Atlas-native-debug-apk` contains the APK for the exact workflow commit. The analyzer also compares camera heading with independent replay truth under stable, fresh, good GPS, and decodes every MP4 to verify recording coverage. A build
artifact alone is not navigation acceptance. Inspect instrumented results,
summary, the movement-frame fraction and recordings before describing a run as end-to-end validated.

Limitations of this replay: mock Android GPS is not radio/GNSS hardware; the offline PMTiles source is selected explicitly; POI/address downloads are
not exercised; extreme multipath and all real-world intersections are not exhaustive.
Search, backup, imports, cartography and other regressions remain covered by the
existing tests. Real-device and full offline package checks are separate evidence.

The cursor retains the same bitmap/design but is now an Android ImageView
positioned through MapLibre projection. Software-GPU recordings exposed a white
silhouette in the legacy annotation-icon path despite a correct source bitmap.
Recenter checkpoints test the blue arrow in actual screenshots. Gesture begin
callbacks release follow synchronously; the coalesced camera-move-start event
can lose its gesture reason during the continuous navigation render loop.
