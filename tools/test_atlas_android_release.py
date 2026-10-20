"""Offline regression tests for the fail-closed Android Release metadata checker."""
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import atlas_android_release as release


class ReleaseIdentityTests(unittest.TestCase):
    CERT = "a" * 64
    WRONG = "b" * 64

    def test_fingerprint_validation_rejects_mismatch(self):
        with tempfile.TemporaryDirectory() as temp:
            file = Path(temp) / "cert.sha256"
            file.write_text(self.WRONG)
            with patch.dict(os.environ, {"ATLAS_ANDROID_CERT_SHA256": self.CERT}):
                with patch.object(sys, "argv", ["tool", "check-cert", "--certificate-file", str(file)]):
                    with self.assertRaisesRegex(SystemExit, "differs from pinned"):
                        release.main()

    def test_missing_fingerprint_fails_closed(self):
        with patch.dict(os.environ, {"ATLAS_ANDROID_CERT_SHA256": ""}):
            with patch.object(sys, "argv", ["tool", "check-cert"]):
                with self.assertRaisesRegex(SystemExit, "64 hexadecimal"):
                    release.main()

    def package(self, prior_code=None, prior_cert=None, release_code=3,
                probe_cert=None, prior_name="0.1.0"):
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            current = folder / "current.apk"
            probe = folder / "probe.apk"
            previous = folder / "previous.apk"
            for target in (current, probe, previous):
                target.write_bytes(target.name.encode())
            expected = self.CERT
            def fake_output(cmd):
                path = Path(cmd[-1])
                if path == previous:
                    name, code, cert = prior_name, prior_code, prior_cert or expected
                elif path == probe:
                    name, code, cert = "0.2.0-upgrade-probe", release_code + 1, probe_cert or expected
                else:
                    name, code, cert = "0.2.0", release_code, expected
                if Path(cmd[0]).name == "aapt":
                    return "package: name='com.atlas.nativeapp' versionCode='%s' versionName='%s'\n" % (code, name)
                return "Signer #1 certificate SHA-256 digest: %s\n" % cert
            cmd = ["tool", "package", "--apk", str(current), "--probe", str(probe),
                   "--build-tools", str(folder), "--version", "0.2.0", "--code", str(release_code),
                   "--commit", "f" * 40, "--output", str(folder / "dist")]
            if prior_code is not None:
                cmd += ["--previous-apk", str(previous), "--previous-manifest", str(folder / "old.json")]
                (folder / "old.json").write_text(json.dumps({
                    "packageId": "com.atlas.nativeapp", "versionCode": prior_code,
                    "versionName": prior_name, "certificateSha256": prior_cert or expected,
                    "apkSha256": hashlib.sha256(previous.read_bytes()).hexdigest(),
                }))
            with patch.dict(os.environ, {"ATLAS_ANDROID_CERT_SHA256": expected}):
                with patch.object(sys, "argv", cmd), patch.object(release, "tool_output", side_effect=fake_output):
                    return_value = None
                    with contextlib.redirect_stdout(io.StringIO()):
                        release.main()
                    manifest = json.loads((folder / "dist/release-manifest.json").read_text())
                    self.assertEqual(manifest["packageId"], "com.atlas.nativeapp")
                    self.assertEqual(manifest["versionCode"], release_code)
                    self.assertTrue((folder / "dist/Atlas-v0.2.0.apk.sha256").is_file())
                    return manifest

    def test_first_release_and_previous_release_metadata(self):
        first = self.package()
        self.assertTrue(first["firstCleanInstallMayBeRequired"])
        with_old = self.package(prior_code=2)
        self.assertFalse(with_old["firstCleanInstallMayBeRequired"])
        self.assertEqual(with_old["previousRelease"]["versionCode"], 2)

    def test_certificate_rotation_rejected(self):
        with self.assertRaisesRegex(SystemExit, "different certificate"):
            self.package(prior_code=2, prior_cert=self.WRONG)
        with self.assertRaisesRegex(SystemExit, "different package or signing certificate"):
            self.package(probe_cert=self.WRONG)

    def test_downgrade_and_reused_version_rejected(self):
        with self.assertRaisesRegex(SystemExit, "versionCode must increase"):
            self.package(prior_code=3)
        with self.assertRaisesRegex(SystemExit, "versionName must increase"):
            self.package(prior_code=2, prior_name="0.2.0")

    def test_previously_distributed_code_two_cannot_be_reused(self):
        with self.assertRaisesRegex(SystemExit, "previously distributed"):
            self.package(release_code=2)


if __name__ == "__main__":
    unittest.main()
