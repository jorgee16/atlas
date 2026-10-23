# Atlas CI FFmpeg installation (2026-10-23)

## Root cause

CI #210's video-tools step began at 08:21:44 UTC and did not finish
until approximately 08:47:41 UTC. Apt requested 62.8 MB of Ubuntu
packages from `azure.archive.ubuntu.com`, including a large codec and
multimedia dependency tree. Downloads were consistently slow and some
large package fetches were retried. It was NOT Python video decoding or
GPS replay computation. This consumed most of the 30-minute Android
job's time limit.

## Resolution

`.github/actions/setup-video-tools/action.yml` pins FFmpeg v9.0.2
from `binmgr/ffmpeg` GitHub Releases, including both `ffmpeg`
and `ffprobe`, without `apt-get`. It verifies the *published SHA-256
digest* of the release archive before installing, caches the
binaries via `actions/cache@v4`, and uses strict download timeouts.

This action is reused by `android`, `android-full-replay`, and
`replay-analysis`. Existing MP4 recordings and native GPS/video
analysers are unchanged. Do not replace them with a Python MP4 reader.

If upstream FFmpeg must change, update the pinned release URL,
SHA-256, and cache key together after verifying the new GitHub release.
