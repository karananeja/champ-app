import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, login, navigate, readOrg } from './helpers';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** "October 2026" for the current IST month (the fixtures were final-approved today). */
const currentMonthLabel = () => {
  const [y, m] = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7).split('-').map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${y}`;
};

// F15: the OM's billing report lists the CR-04 fixture (approved today, billable) and downloads as CSV.
test('an OM sees the approved billable fixture on Billing and downloads the CSV', async ({ page }, testInfo) => {
  const { cr } = readOrg();
  const omId = cr.tasks[testInfo.project.name]!.completed;
  await login(page, cr.om.email, cr.om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.om.name}` })).toBeVisible();
  await navigate(page, 'Billing');
  await expect(page).toHaveURL(/\/reports\/billing$/);
  await expect(page.getByRole('heading', { name: 'Billing', level: 1 })).toBeVisible();

  const month = page.getByRole('combobox', { name: 'Billing month' });
  if (!(await month.textContent())?.includes(currentMonthLabel())) {
    await month.click();
    await page.getByRole('option', { name: currentMonthLabel() }).click();
  }
  await expect(page.getByTestId('total-billable')).not.toHaveText('0');
  const visibleRow = page.getByTestId(/^billing-(row|card)$/).filter({ visible: true }).filter({ hasText: omId });
  await expect(visibleRow).toHaveCount(1);
  await expectNoHorizontalScroll(page);

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^billing-\d{4}-\d{2}.*\.csv$/);
  const content = fs.readFileSync(await download.path(), 'utf8');
  expect(content).toContain(omId);
});

test('an OM sees non-zero submitted and started counts on Analytics', async ({ page }) => {
  const { cr } = readOrg();
  await login(page, cr.om.email, cr.om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.om.name}` })).toBeVisible();
  await navigate(page, 'Analytics');
  await expect(page).toHaveURL(/\/reports\/analytics$/);
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();

  const perDay = page.getByTestId('kpi-per-day');
  await expect(perDay).toContainText(/[1-9]\d* submitted over [1-9]\d* technician-days/);
  await expect(page.getByTestId('kpi-faulty-rate')).toContainText(/of [1-9]\d* started/);
  await expect(page.getByTestId(/^technician-(row|card)$/).filter({ visible: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('an OE sees Analytics but not Billing in the menu', async ({ page }) => {
  const { cr } = readOrg();
  await login(page, cr.oe.email, cr.oe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${cr.oe.name}` })).toBeVisible();
  const hamburger = page.getByRole('button', { name: 'Open menu' });
  if (await hamburger.isVisible()) await hamburger.click();
  const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
  await expect(nav.getByRole('link', { name: 'Analytics', exact: true })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Billing', exact: true })).toHaveCount(0);
  await nav.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Analytics', level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filter by OE' })).toHaveCount(0);
  await expect(page.getByTestId('kpi-per-day')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
