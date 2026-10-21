import unittest

from native_replay_trajectory import is_setup_relocation


class SetupRelocationTest(unittest.TestCase):
    def frames(self):
        return ({'phase': 'drive-plan', 'renderLat': 38.7215, 'renderLon': -9.147},
                {'phase': 'drive-plan', 'speed': 0, 'rawSpeed': 0, 'fixAgeSeconds': .356,
                 'renderLat': 38.72183990481172, 'renderLon': -9.147013664260257,
                 'gpsLat': 38.7218399048, 'gpsLon': -9.14701366425})

    def test_actual_recorded_stationary_fixture_relocation_is_identified(self):
        self.assertTrue(is_setup_relocation(*self.frames()))

    def test_identical_jump_during_driving_is_never_excluded(self):
        before, after = self.frames()
        before['phase'] = after['phase'] = 'drive-accuracy-5.0'
        self.assertFalse(is_setup_relocation(before, after))

    def test_moving_stale_or_wrong_gps_position_is_never_excluded(self):
        for key, value in [('speed', 8), ('rawSpeed', 8), ('fixAgeSeconds', 2),
                           ('gpsLat', 38.72), ('gpsLat', float('nan'))]:
            before, after = self.frames()
            after[key] = value
            self.assertFalse(is_setup_relocation(before, after), f'{key}={value}')

    def test_no_phase_or_phase_transition_cannot_hide_a_jump(self):
        before, after = self.frames()
        before['phase'] = 'reroute-replay'
        self.assertFalse(is_setup_relocation(before, after))
        del after['phase']
        self.assertFalse(is_setup_relocation(before, after))
