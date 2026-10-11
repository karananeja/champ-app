/** CR-02: the desktop sidebar stays in place while the page content scrolls (D-072). */
import { expect, test } from '@playwright/test';
import { login, readOrg } from './helpers';

test('the sidebar does not scroll with long page content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'the sidebar is only shown from md up');
  const { ro } = readOrg();
  await login(page, ro.email, ro.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${ro.name}` })).toBeVisible();

  // Make the page much taller than the viewport, then scroll to the bottom.
  await page.locator('main').evaluate((main) => {
    const filler = document.createElement('div');
    filler.style.height = '4000px';
    main.appendChild(filler);
  });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

  const sidebar = page.locator('aside');
  const box = await sidebar.boundingBox();
  expect(box?.y).toBe(0);
  expect(box?.height).toBe(page.viewportSize()?.height);
  await expect(sidebar.getByRole('link', { name: 'Dashboard' })).toBeInViewport();
});
