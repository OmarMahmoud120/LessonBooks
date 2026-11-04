# Site and player

Run `npm run dev --workspace @lessonbooks/site` from root. Open
http://127.0.0.1:5173. Parent accounts use the local Firebase Auth emulator; start
`npm run emulators` and `npm run dev --workspace @lessonbooks/backend` separately,
or use root `npm run dev` for API plus site.

The parent flow supports sign-up/sign-in, consent confirmation, a nickname profile,
English Year 1/2 selection, PDF upload, generation progress, review, approval and
deletion. This is a local synthetic-content preview, not a kid mode or a launch.

Owned examples: /?example=english, /?example=arabic, /?example=math. Family lessons
are fetched with a parent ID token and are never part of the Hosting bundle.
`npm run build` produces the site and a separate player IIFE/CSS artifact. The
mobile build bundles that player artifact into an HTML document with a restrictive
CSP. Both use the same Player component and shared contract validation/scoring.

Run `npm run test:player` for LTR/RTL, mobile viewport, axe and offline-after-load
checks. No durable download cache or progress persistence exists in Phase 1.
No frontend configuration may contain OpenRouter keys or other secrets.
