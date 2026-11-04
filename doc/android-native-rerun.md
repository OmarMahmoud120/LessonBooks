# Journey: Android parent-to-lesson preview — rerun

Date: 2026-11-04. Final result: **PASS for all 25 journey actions on the fixed build**.
This is native Android emulator evidence, separate from browser tests and iOS exports.

## Startup diagnosis and fix

Starting offline Metro before a cold APK launch restored sign-in with the original
APK. [Startup evidence](evidence/android/startup-ready.png) establishes that React
mounted without an application startup patch. The earlier blank screen's exact
cause was not established; a successful cold launch does not prove the reload path.

Native inspection then exposed controls underneath Android system bars, visible in
[the original WebView](evidence/android/native-lesson.png). The app now uses
react-native-safe-area-context 5.6.2 with a root provider, safe-area views, and dark
status icons. Firebase Auth now explicitly uses memory-only persistence, preserving
the preview's existing session lifetime and removing its missing-persistence warning.
The dependency installation and native build downloads were approved by the user.

## Environment and boundaries

- Pixel_8_35, emulator-5554, Android API 35, arm64-v8a; explicit serial for every device action.
- Android CLI 1.1.16717390; JDK 21; existing Expo-generated mobile/android project.
- Rebuilt debug APK: Gradle succeeded, 192 tasks (59 executed, 133 up-to-date).
- Local Firebase Auth/Firestore/Storage and emulator-only backend with mocked AI.
- Offline Metro, telemetry and dotenv loading disabled. Owned counting.pdf (642 bytes),
  synthetic parent android-complete@example.test, nickname SampleFox, Year 1.
- No physical-phone actions, real family data, paid AI calls, pushes or deployments.
- Host Node was v23.7.0, below the repository's declared >=24 engine. npm warned during
  installation; the checks below report observed results, not Node 24 verification.

## Earlier attempts in this session

The first diagnostic run reached consent. Sending Android Back to dismiss the
keyboard instead left the activity; that run ended. The process remained alive and
no AndroidRuntime crash was reported. A subsequent test helper selected the email
label instead of its input, detected missing focus, and stopped without typing.
The corrected selector used clickable controls and checked FOCUSED before all input.

A pre-fix run reached native answer feedback, but [the development overlay obscured
it](evidence/android/native-feedback.png) and system bars overlapped navigation. It was not counted as a complete pass.
A fixed-build run reached the PDF picker before an approval-review usage limit
interrupted work; the emulator later stopped. The final run restarted at launch
with a fresh synthetic account and completed all actions below.

## Results

Each tap used a preceding Android CLI layout inspection. Input fields were checked
for focus before typing. Every captured screenshot was visually inspected.
The final run saw a Metro development-connection warning after upload; app-scoped
logs identified it as "Cannot connect to Metro", not an application exception.
Its overlay was dismissed using `adb -s emulator-5554 shell input tap 1248 2775`
before opening the lesson. No logging was suppressed in source. Debug transport
reliability remains a follow-up; the loaded app and local API continued working.

### Action: Launch LessonBooks on the selected test emulator. ✅

- **Commands**: `adb -s emulator-5554 reverse tcp:8081 tcp:8081`; `android run mobile/android/app/build/outputs/apk/debug/app-debug.apk --device=emulator-5554`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that the sign-in form and Create account button are visible. ✅

- **Commands**: `android layout --device=emulator-5554`.
- **Comment**: Sign-in and Create account were visible below the status bar. See [corrected sign-in](evidence/android/sign-in-safe-area.png).

### Action: Enter the synthetic email into the Email address field. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 975`; layout confirmed FOCUSED; `adb -s emulator-5554 shell input text android-complete@example.test`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Enter the synthetic password into the Password field. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 1296`; layout confirmed FOCUSED; `adb -s emulator-5554 shell input text <synthetic-test-password>`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Tap Create account. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 1645`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that the parental consent screen is visible. ✅

- **Commands**: `android layout --device=emulator-5554`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Tap Save choices. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 1501`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Tap Save choices in the consent confirmation dialog. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 1046 1733`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that the child profile form is visible. ✅

- **Commands**: `android layout --device=emulator-5554`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Enter SampleFox into the Nickname field. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 1140`; layout confirmed FOCUSED; `adb -s emulator-5554 shell input text SampleFox`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Tap Create profile for Year 1. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 1324`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that Choose a PDF is visible. ✅

- **Commands**: `android layout --device=emulator-5554`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Tap Choose a PDF. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 1169`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Select lessonbooks-counting.pdf from Downloads. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 366 1146`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that the generated lessons appear in the parent library. ✅

- **Commands**: `android layout --device=emulator-5554` after asynchronous generation.
- **Comment**: Counting together, Adding together, and Comparing numbers appeared as Ready for review.

### Action: Tap Review lesson for the first lesson. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 1638`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that the lesson title and first activity are visible in the native WebView. ✅

- **Commands**: `android layout --device=emulator-5554`.
- **Comment**: Counting together and Which number comes after two? appeared inside android.webkit.WebView.

### Action: Select Three and tap Check answer. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 210 2402`; `adb -s emulator-5554 shell input swipe 1080 2550 1080 1750 600`; layout; `adb -s emulator-5554 shell input tap 313 2615`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that correct-answer feedback is visible. ✅

- **Commands**: `android layout --device=emulator-5554`; `android screen capture --device=emulator-5554 -o doc/evidence/android/feedback-safe-area.png`.
- **Comment**: Well done. You found the answer! was visible. See [feedback and safe-area controls](evidence/android/feedback-safe-area.png).

### Action: Tap Approve this lesson. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 380`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that the approval control shows Approved. ✅

- **Commands**: `android layout --device=emulator-5554`.
- **Comment**: APPROVED appeared in the native control and remained Approved after returning to the library.

### Action: Tap Back to your library. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 672 251`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Tap Delete child and their books. ✅

- **Commands**: `adb -s emulator-5554 shell input swipe 1080 2500 1080 1600 600`; layout; `adb -s emulator-5554 shell input tap 672 2630`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Confirm deletion in the dialog. ✅

- **Commands**: `adb -s emulator-5554 shell input tap 866 1641`.
- **Comment**: Completed without an observed crash or unexpected app navigation.

### Action: Verify that the child profile form is visible and the previous lessons are absent. ✅

- **Commands**: `android layout --device=emulator-5554`; `android screen capture --device=emulator-5554 -o doc/evidence/android/deletion-complete.png`.
- **Comment**: The profile creation form returned; lesson cards were absent. See [deletion result](evidence/android/deletion-complete.png). This UI observation does not independently inspect deleted backend objects.

## Remaining limitations

Native TalkBack, Arabic RTL, other screen sizes, native iOS, release-mode launch,
and upload crash-residue cleanup remain unverified. This journey exercised the
first activity only, not all five activity types. The parent form retains its typed
nickname after deletion and a stale "Preparing your lessons" status; these are UI
state follow-ups, not evidence that the deleted lesson cards remain accessible.

## Checks and cleanup

Lint and check:fast passed after the safe-area/auth change (8 agent-policy tests,
22 unit tests, TypeScript and generated drift checks). Offline iOS JavaScript export
passed after the final StatusBar change; it is not native iOS verification.
The final full repository check is recorded in verification.md.

App-scoped final AndroidRuntime/ReactNativeJS error-level logs were empty. Local
Metro, backend and Firebase emulator processes were stopped after the journey;
Firebase state was not exported. The test Android emulator was stopped separately.
