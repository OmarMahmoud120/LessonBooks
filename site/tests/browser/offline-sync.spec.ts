import { test, expect, type Page } from '@playwright/test';

// Requires the local Compose stack (npm run docker:up: API on 3001, Keycloak on 8081)
// and the vite dev server. Skips when either is unreachable so plain `npm run check`
// still passes without the stack.

// Both projects run in parallel and share the API's global per-IP rate limit, so a
// transient failure is possible exactly once in a while. Opening a lesson is one
// fetch with no localStorage fallback for drafts, so retry it once through the UI
// and assert on the player container, which the lesson tiles cannot imitate.
async function openKidLesson(page: Page) {
  const player = page.locator('.lesson-player');
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await page.getByRole('button', { name: 'Review lesson' }).first().click();
    await expect(player)
      .toBeVisible({ timeout: 8000 })
      .catch(() => {});
    if (await player.isVisible()) return;
  }
  await expect(player).toBeVisible();
}
test.beforeEach(async ({ request }) => {
  const health = await request.get('http://127.0.0.1:3001/health').catch(() => null);
  test.skip(!health || !health.ok(), 'backend API not running (start npm run docker:up)');
  const realm = await request
    .get('http://127.0.0.1:8081/realms/lessonbooks/.well-known/openid-configuration')
    .catch(() => null);
  test.skip(!realm || !realm.ok(), 'Keycloak not running (start npm run docker:up)');
});

test('assigned lesson completes offline, restarts, and syncs events exactly once', async ({
  page,
  context,
}) => {
  test.setTimeout(180000);
  // Desktop and mobile projects run in parallel; Date.now() alone can collide.
  const email = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

  // Register a synthetic family through the real Keycloak redirect. The first
  // /v1/family response also creates the parent record; clicking Save choices
  // before it lands would fail the consent writes with family_unavailable.
  const familyLoaded = page.waitForResponse(
    (response) => response.url().includes('/v1/family') && response.status() === 200,
    { timeout: 30000 },
  );
  await page.goto('/');
  await page.locator('.auth-card').getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/127\.0\.0\.1:8081/);
  await page.getByRole('link', { name: 'Register' }).click();
  await page.getByLabel('Username').fill(email.replace(/@.*$/, ''));
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('First name').fill('Offline');
  await page.getByLabel('Last name').fill('Family');
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('SyntheticOffline2026');
  await page.getByRole('textbox', { name: 'Confirm password' }).fill('SyntheticOffline2026');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('http://127.0.0.1:5173/');
  await familyLoaded;

  // Grant both consents and create the child profile.
  const checks = page.locator('input[type="checkbox"]');
  await checks.nth(0).check();
  await checks.nth(1).check();
  await page.getByRole('button', { name: 'Save choices' }).click();
  await page.getByLabel('Nickname').fill('OfflineKid');
  await page.getByRole('button', { name: 'Create profile', exact: true }).click();

  // A parent PIN is required before the child-play entry appears.
  await page.getByRole('button', { name: 'Set parent PIN' }).click();
  await page.getByLabel(/Choose a PIN/).fill('2468');
  await page.getByRole('button', { name: 'Save PIN' }).click();

  // Upload the owned fixture and wait for the three drafts.
  await page.getByLabel('Choose a PDF').setInputFiles('doc/fixtures/books/counting.pdf');
  await page.getByRole('button', { name: 'Create lessons' }).click();
  await expect(page.getByRole('button', { name: 'Review lesson' }).first()).toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByRole('button', { name: 'Review lesson' })).toHaveCount(3);

  // Approve the first draft.
  await openKidLesson(page);
  await page.getByRole('button', { name: 'Approve this lesson' }).click();
  await expect(page.getByText('Approved').first()).toBeVisible();
  await page.getByRole('button', { name: 'Back to your library' }).click();

  // Assign it and enter child play, which caches the lesson for offline use.
  await page.getByRole('button', { name: 'Assign', exact: true }).first().click();
  await page.getByRole('button', { name: 'Child play' }).click();
  await openKidLesson(page);
  await expect(
    page.locator('.lesson-player').getByRole('heading', { name: 'Counting together', exact: true }),
  ).toBeVisible();

  // Go offline and finish all five activities: events queue in localStorage.
  await context.setOffline(true);
  await page.getByRole('radio').nth(1).check();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.getByRole('button', { name: 'Next activity' }).click();
  await page.getByRole('radio').first().check();
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.getByRole('button', { name: 'Next activity' }).click();
  await page.getByRole('textbox').fill('2');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.getByRole('button', { name: 'Next activity' }).click();
  await page.getByRole('combobox').nth(0).selectOption('n2');
  await page.getByRole('combobox').nth(1).selectOption('n3');
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.getByRole('button', { name: 'Next activity' }).click();
  for (const [index, value] of ['small', 'small', 'equal'].entries())
    await page.getByRole('combobox').nth(index).selectOption(value);
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await page.getByRole('button', { name: 'Finish lesson' }).click();
  await expect(page.getByRole('heading', { name: 'Lesson complete' })).toBeVisible();
  await expect(page.locator('.complete')).toContainText('20');

  // Restart with the API unreachable. A true offline reload cannot refetch the
  // app itself (no service worker), so keep the network up and abort only the
  // backend requests; the queue must survive the reload and the failed flush.
  // The exact count varies with how many events flushed while still online; the
  // first check-answer always lands after the offline switch.
  await context.setOffline(false);
  await context.route('http://127.0.0.1:3001/**', (route) => route.abort('connectionrefused'));
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('lessonbooks-event-queue') ?? '[]').length,
      ),
    )
    .toBeGreaterThanOrEqual(4);

  // Reconnect: the flush delivers the queued events exactly once.
  await context.unroute('http://127.0.0.1:3001/**');
  await expect
    .poll(
      () =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem('lessonbooks-event-queue') ?? '[]').length,
        ),
      { timeout: 25000 },
    )
    .toBe(0);

  // The parent dashboard aggregates exactly one completed lesson, not duplicates.
  await page.reload();
  await expect(page.locator('.progress-card')).toContainText('completed 1×');
  await expect(page.locator('.progress-card')).toContainText('100%');
});
