#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.."
mkdir -p ui-preview
# A boot-time Quickstep ANR can cover every application window and make
# Espresso fail for lack of focus. Reset only the emulator launcher; Atlas
# crashes/ANRs remain visible and still fail the unchanged instrumentation.
adb shell dumpsys activity lastanr > ui-preview/emulator-launcher-before-tests.txt || true
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell wm dismiss-keyguard || true
adb shell am force-stop com.android.launcher3 || true
adb emu geo fix -9.1393 38.7223 || true
# Capture native crashes even if the instrumented test process terminates.
adb logcat -c || true
atlas_smoke_exit=0
bash android/gradlew -p android -PnativeOnly :native-app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.notClass=com.atlas.nativeapp.NavigationGpsReplayTest,com.atlas.nativeapp.RouteGeometryVisualReviewTest --stacktrace || atlas_smoke_exit=$?
adb pull /sdcard/Download/atlas-ui-preview ui-preview || true
python3 tools/emit-native-replay-previews.py ui-preview/atlas-ui-preview ui-preview/no-movies || true
adb logcat -d -v threadtime > ui-preview/device-logcat.txt || true
adb logcat -d -s ATLAS_UI_REVIEW:I > ui-preview/layout-diagnostics.txt || true
if [[ "$atlas_smoke_exit" -ne 0 ]]; then
  echo "Atlas Android instrumented tests failed; native crash evidence follows."
  grep -n -A 16 -B 5 -E 'Fatal signal|FATAL EXCEPTION|SIGSEGV|libGLESv2_enc|libmaplibre.so|am_crash' ui-preview/device-logcat.txt | tail -120 || true
fi
exit "$atlas_smoke_exit"
