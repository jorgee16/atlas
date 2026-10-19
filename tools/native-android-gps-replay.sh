#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p ui-preview/gps-replay
adb install -r android/native-app/build/outputs/apk/debug/native-app-debug.apk || exit 1
adb install -r android/native-app/build/outputs/apk/androidTest/debug/native-app-debug-androidTest.apk || exit 1
# Prove public export survives AGP uninstall before spending 12 minutes on GPS.
bash android/gradlew -p android -PnativeOnly :native-app:connectedDebugAndroidTest \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.atlas.nativeapp.NavigationGpsReplayTest#artifactExportProbe' \
  --stacktrace || exit 1
probe="$(adb shell cat /sdcard/Download/atlas-gps-replay/metrics/export-probe.txt)" || exit 1
[[ "$probe" == "ATLAS_EXPORT_PROBE" ]] || exit 1
adb install -r android/native-app/build/outputs/apk/debug/native-app-debug.apk || exit 1
adb install -r android/native-app/build/outputs/apk/androidTest/debug/native-app-debug-androidTest.apk || exit 1
adb shell appops set com.atlas.nativeapp android:mock_location allow || exit 1
adb push atlas-portugal-routing.tar /data/local/tmp/atlas-portugal-routing.tar || exit 1
adb shell 'run-as com.atlas.nativeapp sh -c "mkdir -p files && cd files && tar -xf /data/local/tmp/atlas-portugal-routing.tar"' || exit 1
adb shell mkdir -p /sdcard/Download/atlas-gps-replay
adb logcat -c
# Screenrecord has a three-minute limit. Rotate segments throughout the test.
record() {
  local number=1
  while true; do
    adb shell screenrecord --size 540x960 --bit-rate 1000000 --time-limit 180 "/sdcard/Download/atlas-gps-replay/segment-$number.mp4" || return
    number=$((number+1))
  done
}
record > ui-preview/gps-replay/screenrecord.log 2>&1 &
record_pid=$!
cleanup() {
  kill "$record_pid" 2>/dev/null || true
  adb shell pkill -2 screenrecord || true
  wait "$record_pid" 2>/dev/null || true
  # SIGINT asks screenrecord to flush the MP4 index. Wait before adb pull.
  timeout 15s adb shell 'while pidof screenrecord >/dev/null; do sleep 0.2; done' || true
  cat ui-preview/gps-replay/screenrecord.log || true
  adb pull /sdcard/Download/atlas-gps-replay ui-preview/ || true
  if [[ -d ui-preview/atlas-gps-replay/metrics ]]; then
    cp -R ui-preview/atlas-gps-replay/metrics/. ui-preview/gps-replay/
  fi
  adb logcat -d -v threadtime > ui-preview/gps-replay/logcat.txt || true
}
trap cleanup EXIT
result=0
bash android/gradlew -p android -PnativeOnly :native-app:connectedDebugAndroidTest \
  '-Pandroid.testInstrumentationRunnerArguments.class=com.atlas.nativeapp.NavigationGpsReplayTest#portugalTripThroughAndroidLocationServiceJniAndMapLibre' \
  --stacktrace || result=$?
cleanup
trap - EXIT
python3 tools/emit-native-replay-previews.py || true
if [[ "$result" -eq 0 ]]; then
  python3 tools/analyze-native-gps-replay.py || result=$?
fi
exit "$result"
