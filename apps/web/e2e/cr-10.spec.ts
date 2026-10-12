import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, login, navigate, readOrg, taskTabs } from './helpers';

// CR-10: one Tasks menu item; the task views are tabs (links at their own URLs) on the Tasks page.
test('the menu has a single Tasks item and the tab bar switches between Open and Faulty', async ({ page }) => {
  const { cr } = readOrg();
  await login(page, cr.om.email, cr.om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.om.name}` })).toBeVisible();

  const hamburger = page.getByRole('button', { name: 'Open menu' });
  if (await hamburger.isVisible()) await hamburger.click();
  const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
  await expect(nav.getByRole('link', { name: 'Tasks', exact: true })).toHaveCount(1);
  for (const old of ['Create task', 'Bulk upload', 'Open tasks', 'Faulty tasks', 'Board', 'Re-opened']) {
    await expect(nav.getByRole('link', { name: old, exact: true })).toHaveCount(0);
  }
  await nav.getByRole('link', { name: 'Tasks', exact: true }).click();

  // An OM lands on the Board (the first tab); the menu item stays active on every tab.
  await expect(page).toHaveURL(/\/tasks\/board$/);
  await expect(page.getByRole('heading', { name: 'Tasks', level: 1 })).toBeVisible();
  await expect(taskTabs(page).getByRole('link', { name: 'Board', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(taskTabs(page).getByRole('link')).toHaveText(['Board', 'Open', 'Awaiting approval', 'Re-opened', 'Faulty', 'Completed', 'All', 'Travel']);
  await expect(page.getByRole('main').getByRole('link', { name: 'Create task' })).toHaveCount(0);
  await taskTabs(page).getByRole('link', { name: 'Open', exact: true }).click();

  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible();
  await expect(taskTabs(page).getByRole('link', { name: 'Open', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('main').getByRole('link', { name: 'Create task' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Bulk upload' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await taskTabs(page).getByRole('link', { name: 'Faulty', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/faulty$/);
  await expect(page.getByRole('heading', { name: 'Faulty tasks' })).toBeVisible();
  await expect(taskTabs(page).getByRole('link', { name: 'Faulty', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(taskTabs(page).getByRole('link', { name: 'Open', exact: true })).not.toHaveAttribute('aria-current', 'page');
  // Create task / Bulk upload only on the Open tab.
  await expect(page.getByRole('main').getByRole('link', { name: 'Create task' })).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('link', { name: 'Bulk upload' })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  await taskTabs(page).getByRole('link', { name: 'Open', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible();

  // The header button opens the form, which has no tab bar.
  await navigate(page, 'Create task');
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(taskTabs(page)).toHaveCount(0);
});
