# Atlas native Android — persistent Release signing

Distribution package ID: **`com.atlas.nativeapp`**. GitHub release tags:
`atlas-android-vX.Y.Z`; direct files: `Atlas-vX.Y.Z.apk`.

## Prior signing identity investigation (20 October 2026)

At implementation time, the repository contained no tracked distribution
keystore, no native Release signing configuration, and **no GitHub Releases**
for `jorgee16/atlas`. Debug APKs were distributed via GitHub Actions. This
does NOT prove there is no original keystore on an owner's device, CI secret
store, or external backup. Before introducing a new signing identity, check
all those locations and compare the certificate of any previously distributed
non-debug APK using `apksigner verify --print-certs old.apk`.

**Do not use the Investment Radar signing key for Atlas.** It is a separate
Android application and a separate signing identity.

Android only permits in-place installation with the same package ID,
compatible certificate and a newer `versionCode`. Previously distributed
Atlas debug APKs signed by a different key **cannot** be updated with the
first stable Release. Export/back up Atlas data and trips before uninstalling
the old build, then install the first signed Release cleanly. The app's
`android:allowBackup="false"` means ADB cloud backup is not an alternative.

## One-time repository setup (by owner)

Keep the original keystore if there is an existing distribution identity.
Otherwise create ONE permanent, password-protected upload/release keystore
**locally**, outside the repository, and back it up securely. Never generate
it in CI and never replace it for future versions.

An example, only if no prior distribution key exists:

```bash
mkdir -p "$HOME/.config/atlas"
chmod 700 "$HOME/.config/atlas"
keytool -genkeypair -v -keystore "$HOME/.config/atlas/atlas-release.jks" \
  -alias atlas-release -keyalg RSA -keysize 3072 -validity 10000 \
  -dname "CN=Atlas Android Release,O=Atlas,C=PT"
```

For a separately secured password, record both the keystore and key password.
Then set exactly these GitHub **Actions Secrets** in
`jorgee16/atlas` → Settings → Secrets and variables → Actions → Secrets:

- `ATLAS_ANDROID_KEYSTORE_BASE64`: one-line Base64 of the entire keystore file
- `ATLAS_ANDROID_KEYSTORE_PASSWORD`: keystore password
- `ATLAS_ANDROID_KEY_PASSWORD`: private-key password
- `ATLAS_ANDROID_KEY_ALIAS`: alias of the existing signing key

Example with authenticated GitHub CLI, executed locally (never in CI):

```bash
base64 < "$HOME/.config/atlas/atlas-release.jks" | tr -d '\n' | gh secret set ATLAS_ANDROID_KEYSTORE_BASE64 --repo jorgee16/atlas
gh secret set ATLAS_ANDROID_KEYSTORE_PASSWORD --repo jorgee16/atlas
gh secret set ATLAS_ANDROID_KEY_PASSWORD --repo jorgee16/atlas
gh secret set ATLAS_ANDROID_KEY_ALIAS --repo jorgee16/atlas
```

Set the nonsecret GitHub Actions **variable** `ATLAS_ANDROID_CERT_SHA256`
to the SHA-256 fingerprint of the certificate that MUST be preserved:

```bash
keytool -list -v -keystore "$HOME/.config/atlas/atlas-release.jks" -alias atlas-release
# SHA256 fingerprint: AA:BB:... (64 hex digits, with/without colons)
gh variable set ATLAS_ANDROID_CERT_SHA256 --repo jorgee16/atlas --body 'AA:BB:...'
```

Replace the fingerprint example with the real certificate fingerprint.
The CI uses `keytool -exportcert` and `apksigner verify --print-certs`
to compare it; it rejects a different key, even if the keystore passwords
and alias are valid.

## Release execution

Since the native workflow is currently present **only on the migration branch**
(and not on default `main`), its `workflow_dispatch` UI may not be available
until the workflow also exists on default. To publish reliably **without
changing `main`**, use an explicit push on the migration branch:

1. Update `tools/atlas-release-version.json`: `versionName` = `0.2.0`
   and `versionCode` = `3` for the first Release; strictly increase both
   on later Releases.
2. After the signing secrets and certificate variable are configured, push a
   commit whose message includes **`[atlas-release]`**. For example:

```bash
git checkout migration/native-core-kotlin
git pull --ff-only
git commit --allow-empty -m 'chore(android): publish Atlas v0.2.0 [atlas-release]'
git push origin migration/native-core-kotlin
```

The marker only requests publication. It never bypasses C++, Android, GPS or
emulator checks. On repositories where `workflow_dispatch` is available,
the inputs `publish_release=true`, `release_version=X.Y.Z`,
`release_code=N` remain supported.

The normal push CI builds Debug and runs all existing native/Android checks.
A publication request *forces the full Portugal GPS replay* on the Android
job. Only if core + Android jobs succeed does the Release job:

1. Require all four signing secrets and the fixed certificate variable.
2. Restore the keystore to the ephemeral runner (private key never logged).
3. Build signed Release, Release instrumentation, and a higher-version
   signed upgrade probe; run Release unit tests and lint.
4. Validate APK public certificate with `apksigner`, package ID, version,
   previous published manifest/APK certificate and monotonic versionCode.
5. Emulator test: install prior Release (when available), save Atlas
   settings, `adb install -r` current Release, verify prefs remain.
6. Emulator test: install candidate, save settings, `adb install -r`
   higher-version same-key probe, verify prefs remain.
7. Publish `Atlas-vX.Y.Z.apk` **directly** in GitHub Releases, along with
   a SHA-256 checksum and JSON manifest. Never publish the probe.

If no original key is available, the first Release can only verify
clean installation plus a future upgrade using the new permanent key.
Existing differently signed APKs require a first clean install.

Do not reuse a release version/tag or replace its APK; releases are
append-only. To change certificates, stop publication and perform a
deliberate, documented migration; CI never rotates keys automatically.
