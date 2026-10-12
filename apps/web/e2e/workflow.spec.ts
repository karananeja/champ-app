import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  fitmentAction,
  fitmentItem,
  fitmentItems,
  login,
  navigate,
  pickSearchable,
  readOrg,
  simulate,
  switchUser,
  verifyInSheet,
} from './helpers';

/** F05: the workflow through the dev technician simulator, on desktop and at 360 px. */

const listItem = (page: Page, text: string) =>
  page.locator('[data-testid="fitment-list-row"], [data-testid="fitment-list-card"]').filter({ hasText: text, visible: true });

async function openTask(page: Page, id: string, omId: string) {
  await page.goto(`/tasks/${id}`);
  await expect(page.getByRole('heading', { name: omId })).toBeVisible();
}

const expectStatus = (page: Page, tkId: string, status: string) =>
  expect(fitmentItem(page, tkId)).toHaveAttribute('data-status', status);

async function confirmDialog(page: Page, button: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('full flow to Completed; the OM sees History and raw data, the OE does not', async ({ page }, testInfo) => {
  const { wfOe, wfOm, workflow } = readOrg();
  const { id, omId, tkIds } = workflow[testInfo.project.name]!.flow;
  const tk = tkIds[0]!;

  await login(page, wfOe.email, wfOe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${wfOe.name}` })).toBeVisible();
  await openTask(page, id, omId);
  await expect(page.getByRole('tab', { name: 'History' })).toHaveCount(0); // OE: no History tab
  await expectStatus(page, tk, 'ASSIGNED');

  await simulate(page, 'Start work');
  await expectStatus(page, tk, 'IN_PROGRESS');
  await expect(page.getByTestId('task-status')).toHaveText('In progress');
  await simulate(page, 'Submit');
  await expectStatus(page, tk, 'SUBMITTED');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('oe-submitted.png'), fullPage: true });

  // F06: Verify opens the verification sheet; the required fields must be filled.
  await verifyInSheet(page, tk);
  await expectStatus(page, tk, 'OE_VERIFIED');
  await expect(page.getByRole('button', { name: `Final approve ${tk}` })).toHaveCount(0); // OM only

  await switchUser(page, wfOm.email, wfOm.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${wfOm.name}` })).toBeVisible();
  await openTask(page, id, omId);
  await fitmentAction(page, tk, 'Final approve');
  await confirmDialog(page, 'Final approve');
  await expectStatus(page, tk, 'OM_APPROVED');
  await expect(page.getByTestId('task-status')).toHaveText('Completed');

  // History: stage timeline and raw data with a CSV download.
  await page.getByRole('tab', { name: 'History' }).click();
  const taskStages = page.getByRole('list', { name: 'Task stages' });
  await expect(taskStages.getByRole('listitem')).toHaveCount(4);
  await expect(taskStages.locator('[data-state="done"]')).toHaveCount(4);
  // F06 adds the simulator's PHOTO_ADDED and VERIFY's FITMENT_VERIFICATION_SAVED to the 5 F05 events.
  await expect(page.locator('[data-testid="event-row"], [data-testid="event-card"]').filter({ visible: true })).toHaveCount(7);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('om-history.png'), fullPage: true });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  expect((await download).suggestedFilename()).toMatch(new RegExp(`^champ-${omId}-events-\\d{8}-\\d{4}\\.csv$`));
});

test('reopen with a reason, see it in Re-opened, then redo the fitment', async ({ page }, testInfo) => {
  const { wfOe, workflow, wfTechs } = readOrg();
  const { id, omId, tkIds } = workflow[testInfo.project.name]!.reopen;
  const tk = tkIds[0]!;

  await login(page, wfOe.email, wfOe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${wfOe.name}` })).toBeVisible();
  await openTask(page, id, omId);
  await simulate(page, 'Start work');
  await expectStatus(page, tk, 'IN_PROGRESS');
  await simulate(page, 'Submit');
  await expectStatus(page, tk, 'SUBMITTED');

  await fitmentAction(page, tk, 'Reopen');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Give a reason for reopening (at least 3 characters)');
  await dialog.getByLabel('Reason for reopening').fill('Photos of the wiring are missing');
  await confirmDialog(page, 'Reopen');
  await expectStatus(page, tk, 'REOPENED');
  await expect(fitmentItem(page, tk).getByTestId('reopen-chip')).toHaveText('Reopened ×1');

  await navigate(page, 'Re-opened');
  await expect(page.getByRole('heading', { name: 'Re-opened' })).toBeVisible();
  const row = listItem(page, tk);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Photos of the wiring are missing');
  await expect(row).toContainText(wfTechs[0]!);
  await expect(row.getByTestId('reopen-count')).toHaveText('1');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('reopened.png'), fullPage: true });

  // The same technician redoes it; the OE verifies again.
  await row.getByRole('link', { name: omId }).click();
  await expect(page.getByRole('heading', { name: omId })).toBeVisible();
  await simulate(page, 'Start work');
  await expectStatus(page, tk, 'IN_PROGRESS');
  await simulate(page, 'Submit');
  await expectStatus(page, tk, 'SUBMITTED');
  await verifyInSheet(page, tk);
  await expectStatus(page, tk, 'OE_VERIFIED');
  await expect(fitmentItem(page, tk).getByTestId('reopen-chip')).toHaveText('Reopened ×1');
});

test('mark faulty, assign the replacement, and see both in the Faulty view', async ({ page }, testInfo) => {
  const { wfOe, workflow, wfTechs } = readOrg();
  const { id, omId, tkIds } = workflow[testInfo.project.name]!.faulty;
  const tk = tkIds[0]!;

  await login(page, wfOe.email, wfOe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${wfOe.name}` })).toBeVisible();
  await openTask(page, id, omId);
  const panel = page.getByTestId('simulator-panel');
  await panel.getByRole('button', { name: /Simulate technician \(dev only\)/ }).click();
  await panel.getByRole('button', { name: 'Mark faulty', exact: true }).click();
  await panel.getByLabel('Fault reason').fill('Device does not power on');
  await panel.getByRole('button', { name: 'Confirm mark faulty' }).click();
  await expectStatus(page, tk, 'MOVED_TO_FT');
  await expect(fitmentItem(page, tk)).toContainText('Fault: Device does not power on');

  // A new Open fitment in the same task, linked to the faulty one.
  const replacement = fitmentItems(page).filter({ hasText: `Replacement for ${tk}` });
  await expect(replacement).toHaveAttribute('data-status', 'OPEN');
  const replacementTk = (await replacement.getAttribute('data-tk'))!;
  expect(replacementTk).toMatch(/^TK-\d{5}$/);
  await expect(page.getByTestId('task-status')).toHaveText('Open');
  await expect(fitmentItem(page, tk)).toContainText(`Replaced by ${replacementTk} (Open)`);

  await page.getByRole('checkbox', { name: `Select ${replacementTk}` }).click();
  await pickSearchable(page, page.getByRole('combobox', { name: 'Technician to assign', exact: true }), wfTechs[1]!, wfTechs[1]!);
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expectStatus(page, replacementTk, 'ASSIGNED');
  await expectNoHorizontalScroll(page);

  await navigate(page, 'Faulty tasks');
  await expect(page.getByRole('heading', { name: 'Faulty tasks' })).toBeVisible();
  const row = listItem(page, tk);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Device does not power on');
  await expect(row.getByTestId('replacement')).toContainText(replacementTk);
  await expect(row.getByTestId('replacement')).toContainText('Assigned');
  await expect(row.getByTestId('replacement')).toContainText(wfTechs[1]!);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('faulty.png'), fullPage: true });
});

test('OM bulk final-approves from Awaiting approval', async ({ page }, testInfo) => {
  const { wfOm, workflow } = readOrg();
  const { id, omId, tkIds } = workflow[testInfo.project.name]!.bulk;

  await login(page, wfOm.email, wfOm.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${wfOm.name}` })).toBeVisible();
  await navigate(page, 'Awaiting approval');
  await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible();
  for (const tk of tkIds) {
    await expect(listItem(page, tk)).toHaveCount(1);
    await page.getByRole('checkbox', { name: `Select ${tk}` }).filter({ visible: true }).click();
  }
  await expect(page.getByTestId('selected-count')).toHaveText('2 selected');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('awaiting-approval.png'), fullPage: true });
  await page.getByRole('button', { name: 'Final approve (2)' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(tkIds.join(', '));
  await confirm.getByRole('button', { name: 'Final approve' }).click();
  await expect(page.getByText('Final-approved 2 fitment(s)')).toBeVisible();
  for (const tk of tkIds) await expect(listItem(page, tk)).toHaveCount(0);

  await openTask(page, id, omId);
  await expect(page.getByTestId('task-status')).toHaveText('Completed');
  for (const tk of tkIds) await expectStatus(page, tk, 'OM_APPROVED');
});
