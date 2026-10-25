# 0.1.11 — review build, 2026-10-25

- Random scene in folder and random unmuted track in scene, with synchronized selection.
- Buffered Seamless loop for short direct audio sources.
- Fade-in begins on actual playback, readiness-aware YouTube volume and duration-aware seeking.
- Autoplay error recovery, local playback status, independent runtime cancellation and ordered state broadcasts.
- Correct overlapping pauses, delayed repeats and finished one-shots.
- Sender-role validation, committed/ordered/fresh library persistence, full-library track limit validation.
- Vite security patch to 6.4.5; 45 unit tests and native Chromium audio/UI checks.
- Not deployed upstream; live YouTube inside Owlbear remains an acceptance test. See AUDIT_RU.md.

# Changelog

All notable changes to Ambient Forge are documented in this file.

## 0.1.10 - 2026-10-12

- Avoided redundant Play/Pause commands to unaffected audio and YouTube tracks during scene changes.
- Cleared an old fade-out when the same scene is restarted quickly, preventing overlapping copies.
- Added playback regression tests for fade-out, rapid restart, and 0% YouTube volume.

## 0.1.9 - 2026-09-01

- Made local master volume and mute updates smooth and reliable, including a true mute at 0%.
- Prevented stale master-volume messages from overriding newer changes.
- Preserved list position and control focus after Play, Stop, and volume changes.
- Improved fade-out completion to avoid abrupt source teardown and orphan runtimes.
- Added regression coverage for master-volume synchronization and validation.

## 0.1.8 - 2026-08-31

- Applied supported cloud-link normalization immediately after pasting or editing a URL.
- Normalized links when opening existing scenes while keeping saved scenes compatible.

## 0.1.7 - 2026-08-31

- Added automatic conversion of public Dropbox share links to raw media URLs.
- Applied URL normalization both when saving scenes and when starting playback.
- Added tests for Dropbox link conversion and playback compatibility.

