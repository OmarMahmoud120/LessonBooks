# Journey: Phase 2 family flow — parent to child (Android)

Date: 2026-11-05. Device: Pixel_8 class emulator `emulator-5554` (arm64), debug APK
`com.lessonbooks.preview` with Metro serving the current JS. Host services: Firebase
Auth/Firestore/Storage emulators, backend API on 127.0.0.1:3001 with the local poller;
reached from the emulator through adb reverses (3001/8081/9099/8080/9199). Synthetic
account `android-family@example.test` and owned fixtures only; no family data.

Journey source: `mobile/tests/android-family-flow.journey.xml`. Mobile parity for this
flow was implemented in the same change: add-second-profile form, assign/unassign
actions, a child play view with the assigned lesson first, event forwarding from the
WebView bridge, and a per-child progress card.

## Results

### Action: Verify sign-in screen ✅

- **Screenshot**: [01-signin.png](01-signin.png)
- Email/password fields and CREATE ACCOUNT present.

### Action: Enter credentials and create account ✅

- `adb shell input tap/text` into both fields; fields verified focused and filled.

### Action: Consent screen appears ✅

- **Screenshot**: [02-consent.png](02-consent.png)

### Action: SAVE CHOICES + system dialog ✅

- **Screenshot**: [03-consent-dialog.png](03-consent-dialog.png)
- Native Alert confirmed with SAVE CHOICES.

### Action: Profile creation screen ✅

- "Who is learning?" with nickname field and YEAR 1 / YEAR 2 buttons.

### Action: Create FoxOne ✅

- **Screenshot**: [05-foxone-library.png](05-foxone-library.png)
- Library shows FoxOne, CHILD PLAY, CREATE PROFILE +.

### Action: Upload counting.pdf ✅

- **Screenshots**: [06-picker.png](06-picker.png), [07-uploaded.png](07-uploaded.png)
- System document picker → Downloads → counting.pdf; status "Preparing your lessons".

### Action: Three drafts appear ✅

- **Screenshot**: [08-drafts.png](08-drafts.png)
- Counting together / Adding together / Comparing numbers, "Ready for review".

### Action: Review draft in player ✅

- **Screenshot**: [09-review-player.png](09-review-player.png)

### Action: Approve ✅

- **Screenshot**: [10-approved.png](10-approved.png)

### Action: Assign ✅

- **Screenshots**: [11-approved-list.png](11-approved-list.png), [12-assigned.png](12-assigned.png)
- ASSIGN turns the card to "Assigned" with UNASSIGN.

### Action: Second profile OwlTwo ✅

- **Screenshot**: [14-owltwo-selected.png](14-owltwo-selected.png)
- CREATE PROFILE + opens the profile form; OwlTwo created; child switcher shows
  FOXONE / •OWLTWO.

### Action: Switch to FoxOne ✅

- **Screenshot**: [15-foxone-switched.png](15-foxone-switched.png)
- Switcher selection returns to FoxOne's lessons.

### Action: Child play lists assigned lesson first ✅

- **Screenshot**: [16-child-mode.png](16-child-mode.png)
- Child play view: profile picker, "Counting together — Assigned" first, EXIT CHILD PLAY.

### Action: Finish all five activities ✅

- **Screenshots**: [17-play-mc.png](17-play-mc.png) … [22-completion.png](22-completion.png)
- multiple_choice (Three), true_false (True), fill_in_the_blank (typed "2"),
  drag_to_match (selects Two→2, Three→3), categorize (1,2→Less than 3; 3→Equal to 3).
- Completion card: "Points: 20 of 20". Events (started/answered×5/score/completed)
  were posted to POST /v1/events from the child-mode WebView bridge.

### Action: Parent dashboard shows progress ✅

- **Screenshot**: [23-progress-card.png](23-progress-card.png)
- Progress card: "Counting together — completed 1× · 100%" — events recorded during
  child play, aggregated per child, visible after exiting child play.

## Environment flakes encountered (not app failures)

- The first `firebase emulators:start` run died with "An unexpected error has
  occurred" mid-journey, leaving an orphaned java Firestore process on port 8080;
  the restart then failed with "port taken". Fixed by killing the orphan and
  restarting; the in-memory emulators reset all data, so signup/consent/profile were
  redone from scratch.
- Gboard's stylus handwriting overlay intercepted the first nickname entry attempt
  and swallowed the text; dismissing it and retyping succeeded. Did not recur.

## Honest boundaries

- The PIN gate is not part of this mobile journey: the family PIN and its gate are
  implemented on the site; the mobile preview has no PIN UI yet, so child play is
  entered without a gate on Android.
- "Parent preview. Progress is not saved." copy inside the player is outdated for
  child mode (events do save there); tracked as copy-fix work.
- Debug APK + Metro only; no release-mode or TalkBack run in this journey.
