import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, fitmentItem, login, pickSearchable, readOrg, simulate } from './helpers';

/**
 * F13: the OM assigns a fitment and the dev simulator (D-073) submits it; the task's OE, signed in in another
 * browser, gets a live toast through the Socket.IO proxy, and after a reload the bell still shows it unread.
 * Tapping it marks it read and opens the fitment's verification sheet.
 */
test('a submitted fitment notifies the OE live and in the bell; a tap opens the verification sheet', async ({ page, browser }, testInfo) => {
  const { om, oe, technician, task } = readOrg().f13[testInfo.project.name]!;
  const tk = task.tkIds[0]!;
  const submitted = new RegExp(`^${tk} submitted by .* · ready to verify$`);

  await login(page, oe.email, oe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${oe.name}` })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();

  // The OM, in a browser of their own, assigns the fitment and simulates the technician's work.
  const omContext = await browser.newContext({ ...testInfo.project.use });
  const omPage = await omContext.newPage();
  await login(omPage, om.email, om.password);
  await expect(omPage.getByRole('heading', { name: `Welcome, ${om.name}` })).toBeVisible();
  await omPage.goto(`/tasks/${task.id}`);
  await expect(omPage.getByRole('heading', { name: task.omId })).toBeVisible();
  await omPage.getByRole('checkbox', { name: `Select ${tk}` }).click();
  await pickSearchable(omPage, omPage.getByRole('combobox', { name: 'Technician to assign', exact: true }), technician, new RegExp(technician));
  await omPage.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(fitmentItem(omPage, tk)).toHaveAttribute('data-status', 'ASSIGNED');
  await simulate(omPage, 'Start work');
  await simulate(omPage, 'Submit');
  await expect(fitmentItem(omPage, tk)).toHaveAttribute('data-status', 'SUBMITTED');
  await omContext.close();

  // Live: a toast and the count, without a reload.
  await expect(page.locator('[data-sonner-toast]').getByText(submitted)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread' })).toBeVisible();

  // Still there after a reload (stored, not only pushed).
  await page.reload();
  const bell = page.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(bell).toBeVisible();
  await bell.click();
  const item = page.getByTestId('notification-item').filter({ hasText: `${tk} submitted by` });
  await expect(item).toHaveAttribute('data-unread', 'true');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('oe-bell.png'), fullPage: true });

  await item.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  const sheet = page.getByRole('dialog', { name: `Verify ${tk}` });
  await expect(sheet).toBeVisible();
  // Marked read: the badge is gone once the sheet is closed.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});
