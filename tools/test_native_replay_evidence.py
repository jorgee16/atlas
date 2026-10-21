import importlib.util
import os
from pathlib import Path
import unittest
from unittest.mock import mock_open, patch

spec = importlib.util.spec_from_file_location('resolve_evidence', Path(__file__).with_name('resolve-native-replay-evidence.py'))
resolver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(resolver)


class EvidenceCompatibilityTest(unittest.TestCase):
    def resolve(self, files, status='ahead', base='original', marker='recheck-gps'):
        run = {'status': 'completed', 'head_branch': 'migration/native-core-kotlin', 'head_sha': 'original'}
        comparison = {'files': files, 'status': status, 'merge_base_commit': {'sha': base}}
        with patch.dict(os.environ, COMMIT_MESSAGE=f'fix [{marker}:123]', GH_REPO='jorgee16/atlas',
                        GITHUB_SHA='current', GITHUB_OUTPUT='/tmp/mock-output'), \
             patch.object(resolver, 'github', side_effect=[run, comparison]), \
             patch.object(Path, 'write_text'), patch('builtins.open', mock_open()), patch('builtins.print'):
            resolver.main()

    def test_analyzer_and_instrumentation_only_changes_can_reuse_evidence(self):
        self.resolve([{'filename': 'tools/analyze-native-gps-replay.py'},
                      {'filename': 'android/native-app/src/androidTest/java/ReplayHeadingGate.kt'}])

    def test_release_evidence_uses_the_same_source_identity_guard(self):
        self.resolve([{'filename': 'tools/analyze-native-gps-replay.py'}], marker='release-evidence')
        with self.assertRaises(SystemExit):
            self.resolve([{'filename': 'native/src/motion.cpp'}], marker='release-evidence')

    def test_production_change_requires_fresh_trip(self):
        for path in ['native/src/motion.cpp', 'android/native-app/src/main/java/AtlasMap.kt',
                     'android/native-app/build.gradle', 'src/gps.js']:
            with self.subTest(path=path), self.assertRaises(SystemExit):
                self.resolve([{'filename': path}])

    def test_renamed_production_file_cannot_hide_in_test_directory(self):
        with self.assertRaises(SystemExit):
            self.resolve([{'filename': 'tools/motion.cpp', 'previous_filename': 'native/src/motion.cpp'}])

    def test_divergence_and_truncation_require_fresh_trip(self):
        for status, base in [('diverged', 'original'), ('ahead', 'other')]:
            with self.assertRaises(SystemExit):
                self.resolve([], status, base)
        with self.assertRaises(SystemExit):
            self.resolve([{'filename': f'tools/{i}'} for i in range(300)])
