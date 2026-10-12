import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, fitmentItem, login, pickSearchable, readOrg, switchUser } from './helpers';

/** F10 (D-158): an OE assigns a fitment of their task to themselves; an OM assigns another one to the OE. */
test('an OE assigns a fitment to themselves and an OM assigns one to the OE', async ({ page }, testInfo) => {
  const { om, oe, task } = readOrg().f10[testInfo.project.name]!;
  const [first, second] = task.tkIds as [string, string];
  const assignTo = async (tkId: string) => {
    await page.getByRole('checkbox', { name: `Select ${tkId}` }).click();
    await pickSearchable(page, page.getByRole('combobox', { name: 'Technician to assign', exact: true }), oe.name, `${oe.name} (OE)`);
    await page.getByRole('button', { name: 'Assign', exact: true }).click();
  };

  await login(page, oe.email, oe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${oe.name}` })).toBeVisible();
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole('heading', { name: task.omId })).toBeVisible();
  await assignTo(first);
  await expect(page.getByTestId('fitment-counts')).toHaveText('2 total · 1 assigned · 1 open');
  await expect(fitmentItem(page, first).getByTestId('fitment-technician').filter({ visible: true })).toHaveText(oe.name);

  await switchUser(page, om.email, om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${om.name}` })).toBeVisible();
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByRole('heading', { name: task.omId })).toBeVisible();
  await assignTo(second);
  await expect(page.getByTestId('fitment-counts')).toHaveText('2 total · 2 assigned · 0 open');
  await expect(fitmentItem(page, second).getByTestId('fitment-technician').filter({ visible: true })).toHaveText(oe.name);
  await expectNoHorizontalScroll(page);
});
