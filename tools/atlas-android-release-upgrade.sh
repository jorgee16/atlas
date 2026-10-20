#!/usr/bin/env bash
# This runs exclusively inside the fresh GitHub Actions Android emulator.
# The public release APK stays intact; the higher-version probe is never shipped.
set -euo pipefail
cd "$(dirname "$0")/.."
release_apk="dist/android-release-inputs/release.apk"
probe_apk="dist/android-release-inputs/upgrade-probe.apk"
test_apk="dist/android-release-inputs/instrumentation.apk"
output="dist/android-validated/upgrade-report.txt"
package="com.atlas.nativeapp"
test -s "$release_apk"
test -s "$probe_apk"
test -s "$test_apk"
mkdir -p "$(dirname "$output")"
adb wait-for-device
adb shell getprop sys.boot_completed | grep -q 1
# Only on the disposable CI emulator; never on user devices.
adb uninstall "$package" >/dev/null 2>&1 || true
run_probe() {
  local phase="$1"
  local report
  report="$(adb shell am instrument -w -r \
    -e class 'com.atlas.nativeapp.ReleaseUpgradePersistenceTest#persistsAtlasPreferences' \
    -e upgradePhase "$phase" \
    com.atlas.nativeapp.test/androidx.test.runner.AndroidJUnitRunner)"
  if ! grep -q 'OK (1 test)' <<<"$report"; then
    echo "$report"
    echo "Release instrumentation failed during $phase" >&2
    exit 1
  fi
}
shopt -s nullglob
previous=(dist/android-previous/Atlas-v*.apk)
if (( ${#previous[@]} == 1 )); then
  echo 'Testing previous signed Release -> current Release' | tee -a "$output"
  adb install -r "${previous[0]}"
  adb install -r "$test_apk"
  run_probe write
  # Do NOT uninstall: this is the upgrade acceptance test.
  adb install -r "$release_apk"
  adb install -r "$test_apk"
  run_probe verify
  echo 'Prior Release upgrade preserved Atlas preferences' | tee -a "$output"
else
  echo 'First signed Release: no prior published Atlas APK; testing clean installation' | tee -a "$output"
  adb install -r "$release_apk"
fi
# Validate that the shipped APK can update in place to a FUTURE APK signed
# with the same keystore, without losing map source, theme, voice or stored data.
adb install -r "$test_apk"
run_probe write
adb install -r "$probe_apk"
adb install -r "$test_apk"
run_probe verify
echo 'Current signed Release -> higher-version probe preserved Atlas preferences' | tee -a "$output"
