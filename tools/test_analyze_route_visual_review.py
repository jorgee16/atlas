#!/usr/bin/env python3
"""Regression tests for the real-route visual evidence gate."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ANALYZER = Path(__file__).with_name("analyze-route-visual-review.py")
ROADS = ("lisbon-roundabout", "sintra-curves", "a5-access", "cril-motorway-join")


class RouteVisualReviewContractTest(unittest.TestCase):
    def fixture(self, root):
        cases = []
        for road in ROADS:
            geometry = {
                "nativeRoute": {
                    "edgeIndexes": [1, 2],
                    "points": [[-9.2, 38.7], [-9.21, 38.71], [-9.22, 38.72]],
                    "maneuvers": [{"road": "IC 17", "point": 1}],
                },
                "visual": [[-9.2, 38.7], [-9.21, 38.71], [-9.22, 38.72]],
                "reviewPoint": 1,
            }
            (root / f"{road}-geometry.json").write_text(json.dumps(geometry))
            for dark in (False, True):
                for zoom in (15, 16, 17, 18):
                    source = "online" if road == ROADS[0] and zoom == 18 else "offline"
                    for variant in ("raw", "before", "after"):
                        name = f"{road}-{'dark' if dark else 'light'}-{source}-z{zoom}-{variant}"
                        cases.append({"image": name, "variant": variant, "dark": dark,
                                      "source": source, "zoom": zoom})
                        (root / f"{name}.png").write_bytes(b"\\x89PNG\\r\\n\\x1a\\n" + b"x" * 1024)
        navigation = [f"navigation-{i}" for i in range(4)]
        for name in navigation:
            (root / f"{name}.png").write_bytes(b"\\x89PNG\\r\\n\\x1a\\n" + b"x" * 1024)
        (root / "route-visual-summary.json").write_text(
            json.dumps({"navigationImages": navigation, "cases": cases,
                        "scope": "Real C++ test geometry and MapLibre screenshots"}))

    def run_analyzer(self, root):
        return subprocess.run([sys.executable, str(ANALYZER), str(root)],
                              text=True, capture_output=True, check=False)

    def test_four_real_routes_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result = self.run_analyzer(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("ATLAS_ROUTE_VISUAL_REVIEW", result.stdout)

    def test_missing_ic17_real_route_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / "cril-motorway-join-geometry.json").unlink()
            result = self.run_analyzer(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("cril-motorway-join", result.stderr)

    def test_ic17_wrong_maneuver_anchor_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            path = root / "cril-motorway-join-geometry.json"
            geometry = json.loads(path.read_text())
            geometry["nativeRoute"]["maneuvers"][0]["point"] = 2
            path.write_text(json.dumps(geometry))
            result = self.run_analyzer(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("IC17", result.stderr)


if __name__ == "__main__":
    unittest.main()
