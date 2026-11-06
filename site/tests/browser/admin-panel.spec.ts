import { test, expect } from '@playwright/test';

// Requires the local Compose stack (npm run docker:up) and the vite dev server.
// Signs in as the synthetic local operator from the realm configuration; every
// action is a read, so the journey never mutates family state.
test.beforeEach(async ({ request }) => {
  const health = await request.get('http://127.0.0.1:3001/health').catch(() => null);
  test.skip(!health || !health.ok(), 'backend API not running (start npm run docker:up)');
  const realm = await request
    .get('http://127.0.0.1:8081/realms/lessonbooks/.well-known/openid-configuration')
    .catch(() => null);
  test.skip(!realm || !realm.ok(), 'Keycloak not running (start npm run docker:up)');
});

test('operator signs in and sees the ops dashboard without mutating anything', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Operations admin' })).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/127\.0\.0\.1:8081/);
  // Both projects sign in as the same operator in parallel; Keycloak treats
  // same-second repeated logins as brute force, so resubmit after a pause.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel('Username or email').fill('local-operator');
    await page
      .getByRole('textbox', { name: 'Password', exact: true })
      .fill('SyntheticLocalOperator2026');
    await page.getByRole('button', { name: 'Sign In' }).click();
    if (
      await page.waitForURL(/\/admin/, { timeout: 8000 }).then(
        () => true,
        () => false,
      )
    )
      break;
    await page.waitForTimeout(1500);
  }
  await page.waitForURL(/\/admin/);

  // The realm role unlocks the sections; the API enforces it independently.
  await expect(page.getByRole('heading', { name: 'Generation jobs' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'AI usage' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Family support' })).toBeVisible();
  await expect(page.getByText('Calls:')).toBeVisible();
});
