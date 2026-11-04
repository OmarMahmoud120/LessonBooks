# Mobile parent preview

React Native with Expo SDK 54 local tooling. From root, run `npm run build` first
so mobile/assets/player/player.json exists, then `npm run dev:mobile`. Set
EXPO_NO_TELEMETRY=1 in your shell. Android emulators use 10.0.2.2 for local services;
iOS simulators use 127.0.0.1. Physical-device networking is not configured.

Start root emulators and backend first. Parent mode supports email authentication,
consent confirmation, one profile, PDF selection, lesson review/approval and deletion.
The preview WebView receives structured lesson data, receives no parent token, blocks
external navigation/file access, and validates events against lesson/revision identity.
Temporary upload copies are deleted in finally after an upload attempt. Device-crash
cleanup and device/screen-reader testing still need verification before real data.

`npm run export:ios --workspace @lessonbooks/mobile` verifies JavaScript bundling.
Native builds use `npm run ios --workspace @lessonbooks/mobile` or the Android
counterpart; these may install native dependencies and require separate approval.
No kid mode, assignments, PIN gate, offline download manager or queued progress yet.
Do not put secrets in mobile configuration. See ../doc/milestones.md.
