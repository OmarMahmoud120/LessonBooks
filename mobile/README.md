# Mobile parent preview

React Native with Expo SDK 54 local tooling. From root, run `npm run build` first
so mobile/assets/player/player.json exists, then `npm run dev:mobile`. Set
EXPO_NO_TELEMETRY=1 and EXPO_NO_DOTENV=1 in your shell. Android emulators use 10.0.2.2 for local services;
iOS simulators use 127.0.0.1. Physical-device networking is not configured.

Authentication uses explicit memory-only persistence in this synthetic preview;
a cold process launch requires signing in again. Safe-area insets keep parent
controls and the WebView clear of native system bars.

Start root emulators and backend first. Parent mode supports email authentication,
consent confirmation, one profile, PDF selection, lesson review/approval and deletion.
The preview WebView receives structured lesson data, receives no parent token, blocks
external navigation/file access, and validates events against lesson/revision identity.
Temporary upload copies are deleted in finally after an upload attempt. Device-crash
cleanup, native iOS and screen-reader testing still need verification before real data.
The Android emulator parent-preview journey is recorded in ../doc/android-native-rerun.md.

`npm run export:ios --workspace @lessonbooks/mobile` verifies JavaScript bundling.
Native builds use `npm run ios --workspace @lessonbooks/mobile` or the Android
counterpart; these may install native dependencies and require separate approval.
No kid mode, assignments, PIN gate, offline download manager or queued progress yet.
Do not put secrets in mobile configuration. See ../doc/milestones.md.

## Native Android test

The Android CLI skill is registered in root/mobile AGENTS.md. Generate Android
from this directory using `npx expo prebuild --platform android --no-install`;
the generated project is ignored. Use JDK 21 and the installed Android SDK.
Build from root with `android build 'gradle://mobile/android?app:assembleDebug'`.
Start local Firebase/API services and Metro before launch. From mobile/:

```sh
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 EXPO_NO_DOTENV=1 REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1 ../node_modules/.bin/expo start --offline --port 8081
```

Wait for Metro's ready message before launching. Do not combine `--offline` with
`--localhost`. From root, after confirming the selected test emulator serial:

```sh
adb -s emulator-5554 reverse tcp:8081 tcp:8081
android run mobile/android/app/build/outputs/apk/debug/app-debug.apk --device=emulator-5554
android layout --device=emulator-5554
```

If a launch failed while Metro was unavailable, end that journey, start Metro,
and cold-launch the APK for a new journey. A reload or successful bundle alone
does not prove that React mounted. Check that the sign-in controls are present.
Downloads require approval. See ../doc/android-native-test.md for the original
failure and ../doc/android-native-rerun.md for follow-up evidence.
