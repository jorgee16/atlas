#!/usr/bin/env python3
"""Fail-closed Android certificate, version and update validation.
Only APK public metadata is read. Keystores/passwords are never handled here.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def die(message):
    raise SystemExit("Android Release validation failed: " + message)


def cert_value(value):
    digest = value.lower().replace(":", "").replace(" ", "").strip()
    if not re.fullmatch(r"[a-f0-9]{64}", digest):
        die("Expected SHA-256 certificate digest must contain exactly 64 hexadecimal digits")
    return digest


def tool_output(cmd):
    return subprocess.check_output(cmd, text=True, stderr=subprocess.STDOUT)


def identity(apk, build_tools):
    apk = Path(apk)
    if not apk.is_file() or not apk.stat().st_size:
        die("APK does not exist or is empty: " + str(apk))
    info = tool_output([str(build_tools / "aapt"), "dump", "badging", str(apk)])
    package = re.search(r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']*)'", info, re.M)
    if not package:
        die("Unable to read package/version from " + apk.name)
    signature = tool_output([str(build_tools / "apksigner"), "verify", "--verbose",
                             "--print-certs", str(apk)])
    matches = re.findall(r"Signer #\d+ certificate SHA-256 digest:\s*([a-fA-F0-9:]+)", signature)
    if len(matches) != 1:
        die("Expected exactly one APK signing certificate, got " + str(len(matches)))
    return {
        "packageId": package.group(1),
        "versionCode": int(package.group(2)),
        "versionName": package.group(3),
        "certificateSha256": cert_value(matches[0]),
        "apkSha256": hashlib.sha256(apk.read_bytes()).hexdigest()
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["check-cert", "package"])
    parser.add_argument("--certificate-file")
    parser.add_argument("--apk")
    parser.add_argument("--probe")
    parser.add_argument("--previous-apk")
    parser.add_argument("--previous-manifest")
    parser.add_argument("--build-tools", type=Path)
    parser.add_argument("--version")
    parser.add_argument("--code", type=int)
    parser.add_argument("--commit")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    expected = cert_value(os.environ.get("ATLAS_ANDROID_CERT_SHA256", ""))
    if args.operation == "check-cert":
        if not args.certificate_file:
            die("--certificate-file is required")
        actual = cert_value(Path(args.certificate_file).read_text())
        if actual != expected:
            die("Keystore public certificate SHA-256 differs from pinned ATLAS_ANDROID_CERT_SHA256")
        print("Keystore certificate matches pinned SHA-256.")
        return
    required = (args.apk, args.probe, args.build_tools, args.version,
                args.code, args.commit, args.output)
    if any(x is None for x in required):
        die("Missing APK, probe, build tools or release metadata")
    if not re.fullmatch(r"\d+\.\d+\.\d+", args.version):
        die("Version must be X.Y.Z")
    if args.code <= 2:
        die("versionCode must exceed the previously distributed Atlas native debug code 2")
    tools = args.build_tools
    current = identity(args.apk, tools)
    probe = identity(args.probe, tools)
    if current["packageId"] != "com.atlas.nativeapp":
        die("Atlas applicationId changed")
    if current["versionName"] != args.version or current["versionCode"] != args.code:
        die("Release version does not match requested version/name")
    if current["certificateSha256"] != expected:
        die("Signing certificate is different from the pinned certificate")
    if probe["packageId"] != current["packageId"] or probe["certificateSha256"] != expected:
        die("Probe has a different package or signing certificate")
    if probe["versionCode"] != current["versionCode"] + 1:
        die("The simulated future upgrade must increment versionCode")
    previous = None
    if args.previous_apk or args.previous_manifest:
        if not args.previous_apk or not args.previous_manifest:
            die("Both previous APK and manifest are required")
        previous = identity(args.previous_apk, tools)
        metadata = json.loads(Path(args.previous_manifest).read_text())
        for field in ("packageId", "versionCode", "versionName",
                      "certificateSha256", "apkSha256"):
            if previous[field] != metadata.get(field):
                die("Previous published APK and manifest differ at " + field)
        if previous["packageId"] != current["packageId"]:
            die("Previous Release uses a different package ID")
        if previous["certificateSha256"] != expected:
            die("Previous Release uses a different certificate: key rotation forbidden")
        if current["versionCode"] <= previous["versionCode"]:
            die("versionCode must increase from the previous Release")
        if tuple(map(int,args.version.split("."))) <= tuple(map(int,previous["versionName"].split("."))):
            die("Release versionName must increase")
    directory = args.output
    directory.mkdir(parents=True, exist_ok=True)
    filename = "Atlas-v" + args.version + ".apk"
    shutil.copyfile(args.apk, directory / filename)
    (directory / (filename + ".sha256")).write_text(current["apkSha256"] + "  " + filename + "\n")
    manifest = dict(current, sourceCommit=args.commit, previousRelease=previous,
                    previousReleaseUpgradeTestRequired=previous is not None,
                    syntheticFutureUpgradeVersionCode=probe["versionCode"],
                    firstCleanInstallMayBeRequired=previous is None)
    (directory / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print("Signed APK identity, certificate pin and monotonic version validated.")


if __name__ == "__main__":
    main()
