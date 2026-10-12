import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectNoHorizontalScroll, login, navigate, openTravel, pickSearchable, readOrg, switchUser, travelItem } from './helpers';

/**
 * F08: travel tasks, on desktop and at 360 px, with receipts in the real MinIO (champ-e2e). An OE raises a TT with
 * a receipt, rejects it with a reason, resubmits it with an edit and verifies it (locked); the OM sees it,
 * filters and downloads the CSV and reopens it; an RO sees it read-only.
 */

const RECEIPT = path.resolve(import.meta.dirname, '../../api/src/modules/dev/sample-photos/sample-after.jpg');

/** Runs a sheet action that opens a dialog (Verify confirm, Reject / Reopen reason) and confirms it. */
async function sheetAction(page: Page, action: 'Verify' | 'Reject' | 'Reopen', ttId: string, reason?: string) {
  await page.getByTestId('travel-actions').getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${action} ${ttId}?` });
  await expect(dialog).toBeVisible();
  if (reason) await dialog.getByRole('textbox').fill(reason);
  await dialog.getByRole('button', { name: action, exact: true }).click();
  await expect(dialog).toBeHidden();
}

const detail = (page: Page) => page.getByTestId('travel-detail');

/** Signed in once the dashboard shows (the mobile menu button only exists from then on). */
const signedIn = (page: Page) => expect(page.getByRole('heading', { name: /^Welcome, / })).toBeVisible();

/** No horizontal scroll once the sheet / dialog animations have finished (a sliding sheet is briefly off-screen). */
async function expectSettledNoScroll(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  await expectNoHorizontalScroll(page);
}

test('OE raises a TT with a receipt, rejects, resubmits with an edit and verifies; OM filters, downloads and reopens; RO reads', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const { f08 } = readOrg();
  const { om, oe, technician } = f08.projects[testInfo.project.name]!;

  // --- OE: raise (the only technician is preset), with a receipt; the detail opens.
  await login(page, oe.email, oe.password);
  await signedIn(page);
  await navigate(page, 'Travel tasks');
  await expect(page.getByRole('heading', { name: 'Travel tasks', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filter by OE' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Raise travel task' }).first().click();
  const form = page.getByTestId('travel-form');
  await expect(form.getByTestId('technician-preset')).toHaveText(new RegExp(technician));
  await pickSearchable(page, form.getByRole('combobox', { name: /^Location/ }), 'Beng', /^Bengaluru/);
  await form.getByLabel('Purpose of travel').fill('Picked up a faulty device from the depot');
  await form.getByLabel(/^Distance/).fill('12.5');
  await form.getByLabel('Add receipts').setInputFiles(RECEIPT);
  await expect(form.getByTestId('pending-receipt')).toContainText('sample-after.jpg');
  await expectSettledNoScroll(page);
  await form.getByRole('button', { name: 'Raise travel task' }).click();
  await expect(form).toBeHidden();

  const title = detail(page).getByRole('heading', { name: /^TT-\d{5}$/ });
  await expect(title).toBeVisible();
  const ttId = (await title.textContent())!.trim();
  expect(ttId).toMatch(/^TT-\d{5}$/);
  await expect(detail(page).getByTestId('travel-status')).toHaveText('Raised');
  await expect(detail(page).getByRole('heading', { name: 'Receipts (1)' })).toBeVisible();
  await expect
    .poll(() => detail(page).getByTestId('receipt-image').getByRole('img').evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await expect(detail(page).getByText('12.5 km')).toBeVisible();
  await expectSettledNoScroll(page);
  await page.screenshot({ path: testInfo.outputPath('travel-detail.png'), fullPage: true });

  // Reject with a reason; the OE raised it, so they can resubmit with an edit.
  await sheetAction(page, 'Reject', ttId, 'Distance looks wrong');
  await expect(detail(page).getByTestId('travel-status')).toHaveText('Rejected');
  await expect(detail(page).getByTestId('rejection')).toContainText('Distance looks wrong');
  await detail(page).getByTestId('travel-actions').getByRole('button', { name: 'Resubmit' }).click();
  const resubmit = page.getByTestId('travel-form');
  await expect(resubmit.getByRole('heading', { name: `Resubmit ${ttId}` })).toBeVisible();
  await resubmit.getByLabel(/^Distance/).fill('15');
  await resubmit.getByRole('button', { name: 'Resubmit' }).click();
  await expect(resubmit).toBeHidden();
  await expect(detail(page).getByTestId('travel-status')).toHaveText('Raised');
  await expect(detail(page).getByText('15 km')).toBeVisible();
  const history = detail(page).getByTestId('travel-history');
  await expect(history).toContainText('Reason: Distance looks wrong');
  await expect(history).toContainText('Distance (km): 12.5 → 15');

  // Verify: locked (no more actions, no receipt changes).
  await sheetAction(page, 'Verify', ttId);
  await expect(detail(page).getByTestId('travel-status')).toHaveText('Verified');
  await expect(detail(page).getByTestId('travel-actions')).toHaveCount(0);
  await expect(detail(page).getByText('Add receipts')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(detail(page)).toBeHidden();

  // --- OM: sees it, filters (status + id), downloads the CSV, reopens with a reason.
  await switchUser(page, om.email, om.password);
  await signedIn(page);
  await navigate(page, 'Travel tasks');
  await page.getByRole('combobox', { name: 'Filter by status' }).click();
  await page.getByRole('option', { name: 'Verified', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search by TT id' }).fill(ttId.toLowerCase());
  await expect(page).toHaveURL(/status=VERIFIED/);
  await expect(page).toHaveURL(new RegExp(`q=${ttId.toLowerCase()}`));
  await expect(travelItem(page, ttId)).toHaveCount(1);
  await expect(travelItem(page, ttId)).toContainText(technician);
  await expectSettledNoScroll(page);
  await page.screenshot({ path: testInfo.outputPath('travel-list.png'), fullPage: true });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  await page.getByRole('menuitem', { name: 'CSV', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^champ-travel-tasks-\d{8}-\d{4}\.csv$/);
  const csv = fs.readFileSync((await file.path())!, 'utf8');
  const lines = csv.trim().split('\r\n');
  expect(lines).toHaveLength(2);
  expect(lines[1]).toContain(`${ttId},`);
  expect(lines[1]).toContain(`,${technician},Payroll,${oe.name},Bengaluru,`);
  expect(lines[1]).toContain(',15,Verified,');

  await openTravel(page, ttId);
  await sheetAction(page, 'Reopen', ttId, 'Ticket date does not match');
  await expect(detail(page).getByTestId('travel-status')).toHaveText('Raised');
  await expect(detail(page).getByTestId('travel-history')).toContainText('Reason: Ticket date does not match');
  await page.keyboard.press('Escape');
  await expect(detail(page)).toBeHidden();

  // The OM's dashboard counts it again under "Travel to verify" and links to the Raised list.
  await navigate(page, 'Dashboard');
  const card = page.getByTestId('stat-travelToVerify');
  await expect(card.getByTestId('stat-count')).not.toHaveText('0');
  await card.click();
  await expect(page).toHaveURL(/\/tasks\/travel\?status=RAISED/);
  await expect(page.getByRole('combobox', { name: 'Filter by status' })).toHaveText('Raised');

  // --- RO: read-only.
  await switchUser(page, f08.ro.email, f08.ro.password);
  await signedIn(page);
  await navigate(page, 'Travel tasks');
  await expect(page.getByRole('button', { name: 'Raise travel task' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search by TT id' }).fill(ttId);
  await openTravel(page, ttId);
  await expect(detail(page).getByTestId('travel-actions')).toHaveCount(0);
  await expect(detail(page).getByText('Add receipts')).toHaveCount(0);
  await expect(detail(page).getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expectSettledNoScroll(page);
});
