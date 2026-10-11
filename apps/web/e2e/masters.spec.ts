import { expect, test } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  login,
  masterItem,
  navigate,
  openMaster,
  pickSearchable,
  readOrg,
} from './helpers';

test('an OM adds a billable final issue, edits it and deactivates it', async ({ page }, testInfo) => {
  const { om } = readOrg();
  const name = `Loose connector ${testInfo.project.name} ${Date.now()}`;

  await login(page, om.email, om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${om.name}` })).toBeVisible();
  await openMaster(page, 'Final issues');
  await expectNoHorizontalScroll(page);

  // Add (billable)
  await page.getByRole('button', { name: 'Add final issue' }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByRole('switch', { name: 'Billable' }).click();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(masterItem(page, name)).toContainText('Billable');

  // A duplicate (different case) is rejected with a clear message.
  await page.getByRole('button', { name: 'Add final issue' }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name.toUpperCase());
  await dialog.getByRole('switch', { name: 'Billable' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText(`"${name}" already exists in Final issues`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Edit: rename and make it not billable
  await masterItem(page, name).getByRole('button', { name: `Edit ${name}` }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(`${name} v2`);
  await dialog.getByRole('switch', { name: 'Billable' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  const item = masterItem(page, `${name} v2`);
  await expect(item).toContainText('Not billable');

  // Deactivate (with confirmation): the row stays, greyed out
  await item.getByRole('switch', { name: `Deactivate ${name} v2` }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText(`Deactivate ${name} v2?`);
  await confirm.getByRole('button', { name: 'Deactivate' }).click();
  await expect(confirm).toBeHidden();
  await expect(item).toHaveAttribute('data-active', 'false');
  await expect(item).toContainText('Inactive');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('final-issues.png') });
});

test('a deactivated location disappears from the base-location select', async ({ page }, testInfo) => {
  const { om } = readOrg();
  const city = `Testpur ${testInfo.project.name} ${Date.now()}`;

  await login(page, om.email, om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${om.name}` })).toBeVisible();
  await openMaster(page, 'Locations');

  await page.getByRole('button', { name: 'Add location' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('City').fill(city);
  await pickSearchable(page, dialog.getByRole('combobox', { name: 'State' }), 'Goa', 'Goa');
  await dialog.getByRole('combobox', { name: 'Region' }).click();
  await page.getByRole('option', { name: 'West' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(masterItem(page, city)).toContainText('Goa');

  // The new location is offered in Add technician.
  const openBaseLocation = async () => {
    await navigate(page, 'Technicians');
    await page.getByRole('button', { name: 'Add technician' }).click();
    const techDialog = page.getByRole('dialog', { name: 'Add technician' });
    await techDialog.getByRole('combobox', { name: 'Base location' }).click();
    await page.getByPlaceholder('Search city or state').fill(city);
  };
  await openBaseLocation();
  await expect(page.getByRole('option', { name: new RegExp(city) })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.keyboard.press('Escape');
  await expect(page.getByPlaceholder('Search city or state')).toBeHidden();
  await page.getByRole('dialog', { name: 'Add technician' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Add technician' })).toBeHidden();

  // Deactivate it...
  await openMaster(page, 'Locations');
  await masterItem(page, city).getByRole('switch', { name: `Deactivate ${city}, Goa` }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(masterItem(page, city)).toHaveAttribute('data-active', 'false');

  // ...and it is gone from the select (which reads GET /lookups).
  await openBaseLocation();
  await expect(page.getByText('No active location matches.')).toBeVisible();
  await expect(page.getByRole('option', { name: new RegExp(city) })).toHaveCount(0);
});
