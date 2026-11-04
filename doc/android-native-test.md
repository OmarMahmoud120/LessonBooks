# Journey: Android parent-to-lesson preview

Date: 2026-11-04. Original result: **FAILED during launch; sign-in was not reached**.

Follow-up: [the fixed-build rerun](android-native-rerun.md) completed the native
journey. This report preserves the original failure evidence.

## Environment

- Android CLI 1.1.16717390; existing Pixel_8_35 emulator, emulator-5554, arm64-v8a.
- Package com.lessonbooks.preview; debug APK built with Gradle 8.14.3 and JDK 21.
- Native Android project generated inside mobile/android; output ignored by Git.
- Local Firebase Auth/Firestore/Storage, local backend with mocked AI, and local Metro.
- Owned counting.pdf copied to emulator Downloads. No account or child profile was created.
- A physical phone was connected, but no test actions targeted it.

## Preparation

The first build used JDK 25 and failed with unsupported class file major version 69.
JDK 21 fixed that. The offline build identified missing Gradle dependencies; downloads
were approved. The Android CLI build then completed successfully (169 tasks).

The initial Metro invocation combined incompatible --offline/--localhost flags.
It was corrected to `expo start --offline --port 8081`, with telemetry disabled and
REACT_NATIVE_PACKAGER_HOSTNAME=127.0.0.1. Native build/install success does not prove
that React mounted or that the journey works.

## Results

### Action: Launch LessonBooks on the selected test emulator. ❌

- **Commands**: `android run mobile/android/app/build/outputs/apk/debug/app-debug.apk --device=emulator-5554`; `adb -s emulator-5554 reverse tcp:8081 tcp:8081`.
- **Comment**: APK installed (107.49 MB), but launch displayed an unexpected native Metro error screen. The journey fails here.

### Action: Verify that the sign-in form and Create account button are visible.

- **Commands**: `android layout --device=emulator-5554`; `android screen capture --device=emulator-5554 -o <evidence path>`.
- **Screenshot**: [Initial Metro error](evidence/android/startup-metro-error.png).
- **Comment**: The journey had already ended at launch. Follow-up inspection confirmed sign-in controls were absent. All remaining functional actions were not evaluated.

### Action: Enter the synthetic email into the Email address field.

### Action: Enter the synthetic password into the Password field.

### Action: Tap Create account.

### Action: Verify that the parental consent screen is visible.

### Action: Tap Save choices.

### Action: Tap Save choices in the consent confirmation dialog.

### Action: Verify that the child profile form is visible.

### Action: Enter SampleFox into the Nickname field.

### Action: Tap Create profile for Year 1.

### Action: Verify that Choose a PDF is visible.

### Action: Tap Choose a PDF.

### Action: Select lessonbooks-counting.pdf from Downloads.

### Action: Verify that the generated lessons appear in the parent library.

### Action: Tap Review lesson for the first lesson.

### Action: Verify that the lesson title and first activity are visible in the native WebView.

### Action: Select Three and tap Check answer.

### Action: Verify that correct-answer feedback is visible.

### Action: Tap Approve this lesson.

### Action: Verify that the approval control shows Approved.

### Action: Tap Back to your library.

### Action: Tap Delete child and their books.

### Action: Confirm deletion in the dialog.

### Action: Verify that the child profile form is visible and the previous lessons are absent.

## Limited follow-up diagnostics

After Metro was ready, the observed Reload button was tapped using
`adb -s emulator-5554 shell input tap 1008 2836`. Metro successfully bundled
mobile/index.ts (720 modules). Subsequent Android layout dumps showed an empty
application content tree. [The captured native screen](evidence/android/initial-native-screen.png)
was visually inspected and is blank. This is a second failed startup observation,
not a successful continuation of the journey.

App-scoped logcat (PID 13907) showed React/Expo native initialization and a Firebase
Auth memory-persistence warning. The warning alone does not establish the blank-screen
root cause. No new fatal exception was established from the limited logs reviewed.

The Android CLI skill requires ending the journey at a failed expectation and keeping
troubleshooting limited. Login, consent, profile creation, PDF upload, the native
WebView, approval and deletion were therefore not evaluated and must not be reported
as passing. Next engineering step: diagnose native JS/root mounting, then rerun this
journey from launch after startup is fixed.

## Repository checks and cleanup

Lint and check:fast passed (8 agent-policy/adapter tests and 22 unit tests plus
strict TypeScript and generated drift checks). These do not override the failed
native result. Task-started Metro, backend and Firebase emulator processes were
stopped; the test Android emulator was stopped. No physical phone was targeted.
