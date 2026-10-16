"""Compare the native router with the existing JS engine on identical binary fixtures."""
import json, subprocess, sys
from pathlib import Path
root = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/atlas-native-fixtures')
cli = sys.argv[2] if len(sys.argv) > 2 else '/tmp/atlas_route'
expected = json.loads((root / 'expected.json').read_text())
for case in expected:
    args = [cli, case['directory'], '0', '2', case['profile']]
    if case['avoidTolls']:
        args.append('avoid-tolls')
    actual = json.loads(subprocess.check_output(args, text=True))
    if case['edges'] is None:
        assert actual is None, case
    else:
        assert actual['edgeIndexes'] == case['edges'], (case, actual)
        assert abs(actual['distanceMeters'] - case['distance']) < .01, (case, actual)
        assert abs(actual['durationSeconds'] - case['duration']) < .01, (case, actual)
print(f'{len(expected)} native/JavaScript route comparisons passed')
