#!/usr/bin/env python3
"""Resolve recorded evidence only when application sources are unchanged."""
import json
import os
from pathlib import Path
import re
import subprocess


def github(path):
    return json.loads(subprocess.check_output(['gh', 'api', path], text=True))


def main():
    match = re.search(r'\[(?:recheck-gps|release-evidence):(\d+)\]', os.environ['COMMIT_MESSAGE'])
    if not match:
        raise SystemExit('Missing recorded-evidence RUN_ID marker')
    run_id = match.group(1)
    repo = os.environ['GH_REPO']
    run = github(f'repos/{repo}/actions/runs/{run_id}')
    if run['status'] != 'completed' or run['head_branch'] != 'migration/native-core-kotlin':
        raise SystemExit('Evidence must come from a completed migration-branch run')
    head = os.environ['GITHUB_SHA']
    comparison = github(f'repos/{repo}/compare/{run["head_sha"]}...{head}')
    if comparison['status'] not in ('ahead', 'identical') or comparison['merge_base_commit']['sha'] != run['head_sha']:
        raise SystemExit('Evidence source must be an ancestor of the analysis commit')
    # Fail closed on truncated comparisons or changes outside test/CI/docs.
    files = comparison['files']
    if len(files) >= 300:
        raise SystemExit('Comparison may be truncated')
    allowed = ('.github/', 'tools/', 'docs/', 'android/native-app/src/androidTest/',
               'android/native-app/src/test/')
    changed = [f['filename'] for f in files]
    if any(not p.startswith(allowed) for f in files
           for p in [f['filename'], f.get('previous_filename', f['filename'])]):
        raise SystemExit('Application code changed: a fresh emulator replay is required')
    manifest = {'sourceRun': int(run_id), 'sourceCommit': run['head_sha'],
                'analysisCommit': head, 'changedFiles': changed,
                'scope': 'Recorded full Android trip; application unchanged; no fresh trip. Release still requires JUnit, trajectory, fresh Android smoke, signature and upgrade gates.'}
    Path('replay-analysis-source.json').write_text(json.dumps(manifest, indent=2))
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'run_id={run_id}\n')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
