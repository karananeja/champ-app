import { expect, test } from '@playwright/test';
import {
  acceptInvite,
  expectNoHorizontalScroll,
  login,
  navigate,
  pickSearchable,
  readOrg,
  technicianItem,
} from './helpers';

test('an OM adds a technician who accepts and appears with type and base location', async ({ page, browser }, testInfo) => {
  const { om, oeA } = readOrg();
  const run = `${testInfo.project.name}.${Date.now()}`;
  const name = `Kiran Tech ${run}`;
  const email = `kiran.${run}@example.com`;

  await login(page, om.email, om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${om.name}` })).toBeVisible();
  await navigate(page, 'Technicians');
  await expect(page.getByRole('heading', { name: 'Technicians' })).toBeVisible();

  await page.getByRole('button', { name: 'Add technician' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Contact number').fill('+91 90000 12345');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('radio', { name: 'Contractual' }).click();
  await pickSearchable(page, dialog.getByRole('combobox', { name: 'Base location' }), 'Pune', /Pune, Maharashtra/);
  await dialog.getByRole('combobox', { name: 'Reporting OE' }).click();
  await page.getByRole('option', { name: oeA.name }).click();
  await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: 'Create invite' }).click();

  await expect(dialog.getByText('This link is shown only once and expires in 72 hours')).toBeVisible();
  const link = await dialog.getByLabel('Invite link').inputValue();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // The technician accepts in their own browser session; name and phone are prefilled.
  const techContext = await browser.newContext();
  const techPage = await techContext.newPage();
  await techPage.goto(link);
  await expect(techPage.getByLabel('Full name')).toHaveValue(name);
  await expect(techPage.getByLabel('Phone')).toHaveValue('+91 90000 12345');
  await acceptInvite(techPage, link, name, 'Technician1');
  await expect(techPage.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  await techContext.close();

  await page.reload();
  await page.getByLabel('Search technicians').fill(name);
  const item = technicianItem(page, name);
  await expect(item).toContainText('Contractual');
  await expect(item).toContainText('Pune, Maharashtra');
  await expect(item).toContainText(oeA.name);
  await expect(item).toContainText('active');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('technicians.png') });
});

test('an OE sees and edits only their own technicians', async ({ page }) => {
  const { oeA, techA, techB } = readOrg();

  await login(page, oeA.email, oeA.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${oeA.name}` })).toBeVisible();
  await navigate(page, 'Technicians');
  await expect(page.getByText('Technicians who report to you.')).toBeVisible();

  await expect(technicianItem(page, techA)).toBeVisible();
  await expect(technicianItem(page, techB)).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Filter by reporting OE' })).toHaveCount(0);

  // Edit own technician's type.
  await technicianItem(page, techA).getByRole('button', { name: `Edit ${techA}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Third party' }).click();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(technicianItem(page, techA)).toContainText('Third party');
  await expectNoHorizontalScroll(page);
});
