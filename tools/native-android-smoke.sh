#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
adb emu geo fix -9.1393 38.7223
atlas_smoke_exit=0
bash android/gradlew -p android -PnativeOnly :native-app:connectedDebugAndroidTest --stacktrace || atlas_smoke_exit=$?
# Copy previews while the emulator is still alive, including on test failure.
adb pull /sdcard/Download/atlas-ui-preview ui-preview || true
adb logcat -d -s ATLAS_UI_REVIEW:I > ui-preview/layout-diagnostics.txt || true
exit "$atlas_smoke_exit"
