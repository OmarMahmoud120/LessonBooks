import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
const englishLesson = JSON.parse(readFileSync('doc/fixtures/lessons/english.json', 'utf8'));
test('bundled mobile player validates and renders under its restrictive CSP', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const bundle = JSON.parse(readFileSync('mobile/assets/player/player.json', 'utf8')) as {
    html: string;
  };
  await page.setContent(bundle.html);
  await page.evaluate(
    (lesson) =>
      window.dispatchEvent(
        new MessageEvent('message', { data: { type: 'load_lesson', lesson, revision: 1 } }),
      ),
    englishLesson,
  );
  await expect(page.getByRole('heading', { name: 'Counting together', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
for (const [fixture, check, next, finish, complete, hint] of [
  ['english', 'Check answer', 'Next activity', 'Finish lesson', 'Lesson complete', 'Show a hint'],
  ['arabic', 'تحقق من الإجابة', 'النشاط التالي', 'إنهاء الدرس', 'اكتمل الدرس', 'اعرض تلميحاً'],
] as const) {
  test(`${fixture} is accessible and all five activities work`, async ({ page }) => {
    await page.goto(`/?example=${fixture}`);
    await expect(page.locator('main')).toHaveAttribute('dir', fixture === 'arabic' ? 'rtl' : 'ltr');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('radio').nth(1).check();
    await page.getByRole('button', { name: hint, exact: true }).click();
    await expect(page.getByRole('status')).not.toBeEmpty();
    await page.getByRole('button', { name: check, exact: true }).click();
    await page.getByRole('button', { name: next }).click();
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: check, exact: true }).click();
    await page.getByRole('button', { name: next }).click();
    await page.getByRole('textbox').fill(fixture === 'arabic' ? '٢' : '2');
    await page.getByRole('button', { name: check, exact: true }).click();
    await page.getByRole('button', { name: next }).click();
    await page.getByRole('combobox').nth(0).selectOption('n2');
    await page.getByRole('combobox').nth(1).selectOption('n3');
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: check, exact: true }).click();
    await page.getByRole('button', { name: next }).click();
    for (const [index, value] of ['small', 'small', 'equal'].entries())
      await page.getByRole('combobox').nth(index).selectOption(value);
    await page.getByRole('button', { name: check, exact: true }).click();
    await page.getByRole('button', { name: finish }).click();
    await expect(page.getByRole('heading', { name: complete })).toBeVisible();
    await expect(page.locator('.complete')).toContainText('20');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
test('player remains usable with network disabled after load and keyboard focus is visible', async ({
  page,
  context,
}) => {
  await page.goto('/?example=english');
  await page.getByRole('radio').first().focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(page.getByRole('status')).not.toBeEmpty();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
