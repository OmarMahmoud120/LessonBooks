# Mobile upload-copy recovery — 2026-11-04

## Behavior

The app clears Expo SDK 54's app-private cache/DocumentPicker directory at startup,
before opening a picker, and in finally after the entire selection/upload action.
This includes cancellation, picker failure, FormData construction failure, and HTTP
failure. It also catches partial native copies left before JavaScript receives a
picker result. No age-based retention window is used for these disposable copies.

A shared serial queue protects active selections/uploads from startup cleanup or
another selection. Initial cleanup failure prevents selection; later attempts retry.
Final cleanup failure reaches the existing generic error UI and is retried on the
next launch or upload attempt. No paths, book names, contents, or account identifiers
are logged. The selected original is never a deletion target. The SDK picker cache
is reserved exclusively for uploads; future features must not store persistent data
there. The known directory comes from the installed Android and iOS picker sources.

The upload checks that the signed-in owner has not changed while the picker was
open. Backend family authorization remains authoritative.

## Regression tests

Eleven mocked-filesystem tests cover pre-callback residue, idempotent startup,
success/cancel/picker/FormData/upload failures, preservation of unrelated files and
source URIs, serial execution during an active upload, an abandoned unresolved
session recovered by a fresh process, cleanup failures/retry, and unavailable cache
roots. These tests verify lifecycle policy; native deletion is checked separately.

Full npm run check passed: 8 agent-policy tests, 33 unit tests, 8 browser tests,
3 Firebase emulator tests, plus lint, types, generated drift, fixture validation,
mocked prompt evaluation, and builds. Host Node remains v23.7.0, below declared >=24.
No new dependencies, downloads, paid calls, pushes, or deployments were needed.

## Native Android recovery experiment

Pixel_8_35, emulator-5554, API 35, arm64-v8a. Existing debug APK loaded the changed
JavaScript from offline Metro. This was a focused filesystem recovery experiment,
not a repeat of the full parent-preview journey. The physical phone was not used.

1. Stopped the app with `adb -s emulator-5554 shell am force-stop com.lessonbooks.preview`.
2. Pushed the owned counting.pdf (642 bytes) to /data/local/tmp/lessonbooks-cleanup-owned.pdf.
3. With `adb -s emulator-5554 shell run-as com.lessonbooks.preview`, created
   cache/DocumentPicker/interrupted.pdf and cache/cleanup-control/keep.pdf from that source.
   Both copies existed before launch. The first represents residue after termination.
4. Started Metro with offline, telemetry-disabled, dotenv-disabled settings. Reversed
   port 8081 and launched with `android run mobile/android/app/build/outputs/apk/debug/app-debug.apk --device=emulator-5554`.
5. `android layout --device=emulator-5554` showed sign-in and Create account.
   `run-as ... ls -ld cache/DocumentPicker` returned No such file or directory.
6. Source and sibling-control SHA-256 both remained
   0d00780dc5d6cf26b1538307f62d4350bf69ee4917bb0a5450beb6bb9bd75d42.
7. Cold-launched again with the directory already absent. Sign-in remained available,
   no cleanup error appeared, and the sibling control checksum remained unchanged.
8. Captured and visually inspected [second startup](evidence/android/upload-cleanup-startup.png).
   Stopped task-started Metro and the test emulator. Full-check Firebase emulators
   shut down automatically. Synthetic control files remain only in the test emulator.

This verifies native removal of seeded interrupted-copy residue on restart. It does
not reproduce an OS crash during the native picker copy or HTTP transport. Those
interleavings are modeled by tests. Native iOS recovery remains unverified and is
tracked with native iOS execution in the polishing phase. If the app is never
reopened, startup cleanup cannot run; this is not a secure-erasure or OS-cache
retention guarantee.

## Privacy review

Read-only self-review used the privacy-review skill and traced SDK copying, upload,
error handling, queue ownership, and deletion targets. No additional data fields,
providers, trackers, persistence stores, or logging were introduced. Cleanup uses a
fixed app-private SDK directory rather than a picker-provided source URI. No
unresolved findings in this change; independent reviewer coverage remains scheduled
for polishing. Real-data retention and legal decisions remain external launch gates.
