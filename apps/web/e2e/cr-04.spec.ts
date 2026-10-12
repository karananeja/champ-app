import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, login, navigate, pickDateRange, readOrg, taskItem } from './helpers';

// CR-04: Completed tasks and All tasks views; the date-range filter is a calendar, and clearing it removes it.
test('an RO finds completed tasks under Completed tasks and filters All tasks by status and a date range', async ({ page }, testInfo) => {
  const { cr } = readOrg();
  const { completed, march } = cr.tasks[testInfo.project.name]!;
  await login(page, cr.ro.email, cr.ro.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.ro.name}` })).toBeVisible();

  await navigate(page, 'Completed tasks');
  await expect(page.getByRole('heading', { name: 'Completed tasks' })).toBeVisible();
  await expect(taskItem(page, completed)).toBeVisible();
  await expect(taskItem(page, completed)).toContainText('Completed');
  await expect(taskItem(page, march)).toHaveCount(0);
  // Completed tasks are all Completed: no status filter. Search and download work as on Open tasks.
  await expect(page.getByRole('combobox', { name: 'Filter by status' })).toHaveCount(0);
  await page.getByLabel('Search tasks').fill(completed);
  await expect(taskItem(page, completed)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  await page.getByRole('menuitem', { name: 'CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(/^champ-tasks-\d{8}-\d{4}\.csv$/);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('completed-tasks.png'), fullPage: true });

  await navigate(page, 'All tasks');
  await expect(page.getByRole('heading', { name: 'All tasks' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter by status' }).click();
  await page.getByRole('option', { name: 'Completed', exact: true }).click();
  await expect(taskItem(page, completed)).toBeVisible();
  await expect(taskItem(page, march)).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();

  // One date-range calendar: 1–31 Mar 2027 (IST) shows only the March task.
  const range = page.getByRole('button', { name: /^Filter by fitment date/ });
  await expect(range).toHaveText('Any fitment date');
  await pickDateRange(page, range, '2027-03-01', '2027-03-31');
  await expect(range).toHaveText('1 Mar 2027 – 31 Mar 2027');
  await expect(taskItem(page, march)).toBeVisible();
  await expect(taskItem(page, completed)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('all-tasks-date-range.png'), fullPage: true });

  // Clearing the range removes the filter.
  await page.getByRole('button', { name: 'Clear Filter by fitment date' }).click();
  await expect(range).toHaveText('Any fitment date');
  await expect(taskItem(page, completed)).toBeVisible();
});
