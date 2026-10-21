from pathlib import Path
import tempfile
import unittest

from verify_native_replay_instrumentation import verify


class RecordedTripCompletionTest(unittest.TestCase):
    def report(self, root, body='', name='portugalTripThroughAndroidLocationServiceJniAndMapLibre'):
        Path(root, 'result.xml').write_text(f'<testsuite><testcase classname="com.atlas.nativeapp.NavigationGpsReplayTest" name="{name}">{body}</testcase></testsuite>')

    def test_successful_actual_full_trip_is_required(self):
        with tempfile.TemporaryDirectory() as root:
            self.report(root)
            self.assertEqual(len(verify(root)), 1)

    def test_failed_skipped_or_partial_trip_cannot_be_reused(self):
        for body in ['<failure/>', '<error/>', '<skipped/>']:
            with tempfile.TemporaryDirectory() as root, self.assertRaises(ValueError):
                self.report(root, body)
                verify(root)
        with tempfile.TemporaryDirectory() as root, self.assertRaises(ValueError):
            self.report(root, name='artifactExportProbe')
            verify(root)

    def test_missing_report_cannot_be_reused(self):
        with tempfile.TemporaryDirectory() as root, self.assertRaises(ValueError):
            verify(root)
