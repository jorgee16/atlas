#!/usr/bin/env python3
"""Require an actually completed, passing full Android trip in recorded evidence."""
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def verify(root):
    matches = []
    for path in Path(root).rglob('*.xml'):
        document = ET.parse(path)
        for case in document.iter('testcase'):
            if case.get('classname') != 'com.atlas.nativeapp.NavigationGpsReplayTest':
                continue
            if not case.get('name', '').startswith('portugalTripThroughAndroidLocationServiceJniAndMapLibre'):
                continue
            if any(case.find(tag) is not None for tag in ('failure', 'error', 'skipped')):
                raise ValueError(f'Full Android replay did not pass: {path}')
            matches.append(str(path))
    if not matches:
        raise ValueError('Missing successful full Android replay JUnit result')
    return matches


if __name__ == '__main__':
    print('Verified passing full Android trip: ' + ', '.join(verify(sys.argv[1])))
