#!/usr/bin/env bash
set -u
cd "$(dirname "$0")/.."
adb emu geo fix -9.1393 38.7223
atlas_smoke_exit=0
bash android/gradlew -p android -PnativeOnly :native-app:connectedDebugAndroidTest --stacktrace || atlas_smoke_exit=$?
# Copy previews while the emulator is still alive, including on test failure.
adb pull /sdcard/Android/data/com.atlas.nativeapp/files/ui-preview ui-preview || true
exit "$atlas_smoke_exit"
