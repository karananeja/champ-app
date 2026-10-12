import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, login, navigate, readOrg } from './helpers';

// CR-03: illustrations, split-screen sign-in, brand colour (light and dark), role-aware dashboard, 404/403 pages.

const illustration = (page: Page, name: string) => page.locator(`[data-illustration="${name}"]`).filter({ visible: true });

test('sign-in is split screen on desktop and stacked on phones; the brand colour follows light and dark mode', async ({ page }, testInfo) => {
  const desktop = testInfo.project.name === 'desktop';
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(illustration(page, 'login')).toHaveCount(1);
  await expect(page.getByTestId('auth-aside')).toBeVisible({ visible: desktop });
  await expect(illustration(page, 'login').locator('svg')).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });

  // Indigo primary (indigo-600) in light mode; indigo-400 in dark mode.
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  const button = () => page.getByRole('button', { name: 'Sign in' }).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await primary()).toBe('oklch(0.511 0.262 276.966)');
  const lightButton = await button();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  expect(await primary()).toBe('oklch(0.673 0.182 276.935)');
  expect(await button()).not.toBe(lightButton);
  await page.screenshot({ path: testInfo.outputPath('login-dark.png'), fullPage: true });
});

test('an invalid invite link shows the invite-error illustration and a way to sign in', async ({ page }) => {
  await page.goto('/accept-invite?token=not-a-real-token');
  await expect(page.getByRole('alert')).toContainText('This invite link is not valid');
  await expect(illustration(page, 'invite-error')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('OM dashboard: stat cards link to their lists; unknown URLs show the 404 page', async ({ page }, testInfo) => {
  const { cr } = readOrg();
  await login(page, cr.om.email, cr.om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.om.name}` })).toBeVisible();
  for (const key of ['openTasks', 'awaitingApproval', 'reopened', 'faulty', 'completedTasks']) {
    await expect(page.getByTestId(`stat-${key}`).getByTestId('stat-count')).toHaveText(/^\d+$/);
  }
  await expect(page.getByTestId('stat-assignedToMe')).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('dashboard-om.png'), fullPage: true });

  await page.getByTestId('stat-completedTasks').click();
  await expect(page).toHaveURL(/\/tasks\/completed$/);
  await expect(page.getByRole('heading', { name: 'Completed tasks' })).toBeVisible();

  await page.goto('/this/page/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(illustration(page, 'not-found')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: 'Go to the dashboard' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.om.name}` })).toBeVisible();
});

test('OE dashboard has their own cards; an empty list shows an illustration; a page they cannot open shows 403', async ({ page }) => {
  const { cr } = readOrg();
  await login(page, cr.oe.email, cr.oe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.oe.name}` })).toBeVisible();
  await expect(page.getByTestId('stat-assignedToMe').getByTestId('stat-count')).toHaveText(/^[1-9]\d*$/);
  await expect(page.getByTestId('stat-awaitingMyVerification')).toBeVisible();
  await expect(page.getByTestId('stat-awaitingApproval')).toHaveCount(0);

  // The OE's own fitments were never reopened: the illustrated empty state.
  await navigate(page, 'Re-opened');
  await expect(page.getByRole('heading', { name: 'No fitment has been reopened.' })).toBeVisible();
  await expect(illustration(page, 'all-done')).toHaveCount(1);

  // Client editing is for SA/OM: a direct URL shows the 403 page.
  await page.goto('/clients/new');
  await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
  await expect(illustration(page, 'access-denied')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
});

test('RO dashboard shows open and completed task cards only', async ({ page }) => {
  const { cr } = readOrg();
  await login(page, cr.ro.email, cr.ro.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.ro.name}` })).toBeVisible();
  await expect(page.getByTestId('stat-openTasks').getByTestId('stat-count')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('stat-completedTasks').getByTestId('stat-count')).toHaveText(/^[1-9]\d*$/);
  await expect(page.getByRole('list', { name: 'Summary' }).getByRole('link')).toHaveCount(2);
});
