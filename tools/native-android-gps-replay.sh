#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
mode="${1:-full}"
test_class=com.atlas.nativeapp.NavigationGpsReplayTest
if [[ "$mode" == camera ]]; then
  collection=atlas-camera-smoke
  metrics_dir=ui-preview/camera-smoke
  method=cameraModesAndStationaryWalkingThroughAndroidLocation
elif [[ "$mode" == tolls ]]; then
  collection=atlas-toll-review
  metrics_dir=ui-preview/toll-review
  method=a5MainlineTollsThroughJniAndMapLibrePreview
elif [[ "$mode" == full ]]; then
  collection=atlas-gps-replay
  metrics_dir=ui-preview/gps-replay
  method=portugalTripThroughAndroidLocationServiceJniAndMapLibre
elif [[ "$mode" == visual ]]; then
  collection=atlas-route-visual-review
  metrics_dir=ui-preview/route-visual-review
  test_class=com.atlas.nativeapp.RouteGeometryVisualReviewTest
  method=compareRealPortugalRoadGeometryAtStreetZooms
else
  echo "Unknown replay mode: $mode" >&2
  exit 2
fi
mkdir -p "$metrics_dir"
adb install -r android/native-app/build/outputs/apk/debug/native-app-debug.apk || exit 1
adb install -r android/native-app/build/outputs/apk/androidTest/debug/native-app-debug-androidTest.apk || exit 1
# Prove public export survives AGP uninstall before spending 12 minutes on GPS.
bash android/gradlew -p android -PnativeOnly :native-app:connectedDebugAndroidTest \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.atlas.nativeapp.NavigationGpsReplayTest#artifactExportProbe' \
  "-Pandroid.testInstrumentationRunnerArguments.evidenceDirectory=$collection" \
  --stacktrace || exit 1
probe="$(adb shell cat /sdcard/Download/$collection/metrics/export-probe.txt)" || exit 1
[[ "$probe" == "ATLAS_EXPORT_PROBE" ]] || exit 1
adb install -r android/native-app/build/outputs/apk/debug/native-app-debug.apk || exit 1
adb install -r android/native-app/build/outputs/apk/androidTest/debug/native-app-debug-androidTest.apk || exit 1
adb shell appops set com.atlas.nativeapp android:mock_location allow || exit 1
adb push atlas-portugal-routing.tar /data/local/tmp/atlas-portugal-routing.tar || exit 1
adb shell 'run-as com.atlas.nativeapp sh -c "mkdir -p files && cd files && tar -xf /data/local/tmp/atlas-portugal-routing.tar"' || exit 1
adb shell mkdir -p /sdcard/Download/$collection
adb logcat -c
# Screenrecord has a three-minute limit. Rotate segments throughout the test.
record() {
  local number=1
  while true; do
    adb shell screenrecord --size 540x960 --bit-rate 1000000 --time-limit 180 "/sdcard/Download/$collection/segment-$number.mp4" || return
    number=$((number+1))
  done
}
record > "$metrics_dir/screenrecord.log" 2>&1 &
record_pid=$!
cleanup() {
  kill "$record_pid" 2>/dev/null || true
  adb shell pkill -2 screenrecord || true
  wait "$record_pid" 2>/dev/null || true
  # SIGINT asks screenrecord to flush the MP4 index. Wait before adb pull.
  timeout 15s adb shell 'while pidof screenrecord >/dev/null; do sleep 0.2; done' || true
  cat "$metrics_dir/screenrecord.log" || true
  adb pull /sdcard/Download/$collection ui-preview/ || true
  if [[ -d "ui-preview/$collection/metrics" ]]; then
    cp -R "ui-preview/$collection/metrics/." "$metrics_dir/"
  fi
  adb logcat -d -v threadtime > "$metrics_dir/logcat.txt" || true
}
trap cleanup EXIT
result=0
bash android/gradlew -p android -PnativeOnly :native-app:connectedDebugAndroidTest \
  "-Pandroid.testInstrumentationRunnerArguments.class=$test_class#$method" \
  "-Pandroid.testInstrumentationRunnerArguments.evidenceDirectory=$collection" \
  --stacktrace || result=$?
cleanup
trap - EXIT
python3 tools/emit-native-replay-previews.py "$metrics_dir" "ui-preview/$collection" || true
if [[ "$result" -eq 0 ]]; then
  if [[ "$mode" == tolls ]]; then
    python3 tools/verify-toll-android-proof.py "$metrics_dir" || result=$?
  elif [[ "$mode" == visual ]]; then
    python3 tools/analyze-route-visual-review.py "$metrics_dir" || result=$?
  else
    python3 tools/analyze-native-gps-replay.py "$mode" || result=$?
    if [[ "$mode" == camera && "$result" -eq 0 ]]; then
      python3 tools/analyze-camera-turns.py "$metrics_dir" || result=$?
    fi
  fi
fi
exit "$result"

