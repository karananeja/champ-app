import { expect, test, type Page } from '@playwright/test';
import { BULK_TASK_COLUMNS, toCsv } from '@champ/shared';
import { expectNoHorizontalScroll, fitmentItems, login, navigate, pickDateTime, pickSearchable, readOrg, taskItem } from './helpers';

const combo = (page: Page, name: string) => page.getByRole('combobox', { name, exact: true });

/** Fills the header fields every test task shares (customer = the setup client, single site). */
async function fillTask(page: Page, client: string, options: { oe?: string; battery?: boolean } = {}) {
  await pickSearchable(page, combo(page, 'Customer'), client, new RegExp(client));
  await expect(combo(page, 'Site')).toHaveText(/Whitefield depot/);
  await expect(page.getByLabel('POC name')).toHaveValue('Asha Rao');
  await expect(page.getByLabel('POC phone')).toHaveValue('+91 90000 22222');
  if (options.oe) await pickSearchable(page, combo(page, 'Operation executive'), options.oe, options.oe);
  if (options.battery) {
    await pickSearchable(page, combo(page, 'Asset type'), 'Battery', 'Battery');
    await expect(combo(page, 'Vehicle make/model')).toHaveCount(0);
  } else {
    await pickSearchable(page, combo(page, 'Asset type'), 'Vehicle', 'Vehicle');
    await pickSearchable(page, combo(page, 'Vehicle make/model'), 'Ace', 'Tata Ace');
  }
  await pickSearchable(page, combo(page, 'Activity'), 'New', 'New installation');
  await expect(combo(page, 'Device type')).toHaveText(/LAF5/);
  await pickSearchable(page, combo(page, 'Installation type'), 'GPS', /^GPS$/);
  await pickDateTime(page, page.locator('#task-requested-at'), '2026-11-10T09:00');
  await pickDateTime(page, page.locator('#task-fitment-at'), '2026-11-11T10:30');
  await expect(page.locator('#task-fitment-at')).toHaveText('11 Nov 2026, 10:30');
  await page.getByRole('radio', { name: 'Day' }).click();
  await pickSearchable(page, combo(page, 'Issue reported by client'), 'not reporting', 'Device not reporting');
}

test('an OM creates a task for 3 vehicles without a technician, then assigns fitments to two technicians', async ({ page }, testInfo) => {
  const { taskOm, taskOe, techA, techB, client } = readOrg();
  await login(page, taskOm.email, taskOm.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${taskOm.name}` })).toBeVisible();
  await navigate(page, 'Create task');
  await expect(page.getByRole('heading', { name: 'Create task' })).toBeVisible();

  await fillTask(page, client, { oe: taskOe.name });
  await page.getByLabel('Number of vehicles', { exact: true }).fill('3');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('task-form.png'), fullPage: true });
  await page.getByRole('button', { name: 'Create task' }).click();

  const heading = page.getByRole('heading', { name: /^OM-\d{5}$/ });
  await expect(heading).toBeVisible();
  const omId = (await heading.textContent())!;
  await expect(page.getByTestId('oe-task-id')).toHaveText(/^OE-\d{5}$/);
  await expect(page.getByTestId('task-status')).toHaveText('Open');
  await expect(page.getByTestId('fitment-counts')).toHaveText('3 total · 0 assigned · 3 open');
  await expect(fitmentItems(page)).toHaveCount(3);
  // CR-04: the IST time picked in the calendar is what the task shows.
  await expect(page.getByText('11 Nov 2026, 10:30').first()).toBeVisible();
  await expect(page.getByText('Bengaluru, Karnataka')).toBeVisible(); // fitment location from the site

  // Assign the first fitment to technician A, the other two to technician B.
  const checkboxes = page.getByRole('checkbox', { name: /^Select TK-\d{5}$/ });
  await checkboxes.nth(0).click();
  await pickSearchable(page, combo(page, 'Technician to assign'), techA, techA);
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByTestId('fitment-counts')).toHaveText('3 total · 1 assigned · 2 open');
  await checkboxes.nth(1).click();
  await checkboxes.nth(2).click();
  await expect(page.getByTestId('selected-count')).toHaveText('2 selected');
  await pickSearchable(page, combo(page, 'Technician to assign'), techB, techB);
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByTestId('fitment-counts')).toHaveText('3 total · 3 assigned · 0 open');
  await expect(page.getByTestId('task-status')).toHaveText('Assigned');
  await expect(fitmentItems(page).getByTestId('fitment-technician').filter({ visible: true })).toHaveText([techA, techB, techB]);
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('task-detail.png'), fullPage: true });

  // The Open tasks list finds it by id and shows the counts; downloads fire.
  await navigate(page, 'Open tasks');
  await page.getByLabel('Search tasks').fill(omId.toLowerCase());
  await expect(taskItem(page, omId)).toHaveCount(1);
  await expect(taskItem(page, omId).getByTestId('task-fitments').filter({ visible: true })).toHaveText('3/3');
  await expectNoHorizontalScroll(page);
  await page.getByLabel('Search tasks').fill('');
  await page.screenshot({ path: testInfo.outputPath('task-list.png'), fullPage: true });
  await page.getByLabel('Search tasks').fill(omId.toLowerCase());
  for (const [item, extension] of [
    ['CSV', 'csv'],
    ['Excel (.xlsx)', 'xlsx'],
  ] as const) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    await page.getByRole('menuitem', { name: item }).click();
    expect((await download).suggestedFilename()).toMatch(new RegExp(`^champ-tasks-\\d{8}-\\d{4}\\.${extension}$`));
  }
});

test('an OE creates a task with a vehicle CSV; the OE field is locked and the task is under Assigned', async ({ page }) => {
  const { taskOe, client } = readOrg();
  await login(page, taskOe.email, taskOe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${taskOe.name}` })).toBeVisible();
  await navigate(page, 'Create task');
  await expect(combo(page, 'Operation executive')).toBeDisabled();
  await expect(combo(page, 'Operation executive')).toHaveText(taskOe.name);

  await fillTask(page, client, { battery: true });
  await page.getByRole('radio', { name: 'Upload CSV' }).click();
  const sample = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download sample CSV' }).click();
  expect((await sample).suggestedFilename()).toBe('champ-vehicles-sample.csv');
  await page.getByLabel('Vehicle CSV').setInputFiles({
    name: 'vehicles.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('registration_number,chassis_number,asset_number,old_device_id\nKA05MN1001,CH-1,,\nKA05MN1002,,AST-2,OLD-2\n'),
  });
  await expect(page.getByTestId('vehicle-csv-summary')).toHaveText('vehicles.csv: 2 vehicle(s)');
  await expectNoHorizontalScroll(page);
  await page.getByRole('button', { name: 'Create task' }).click();

  const heading = page.getByRole('heading', { name: /^OM-\d{5}$/ });
  await expect(heading).toBeVisible();
  const omId = (await heading.textContent())!;
  await expect(fitmentItems(page)).toHaveCount(2);
  await expect(fitmentItems(page).nth(0)).toContainText('KA05MN1001');
  await expect(fitmentItems(page).nth(1)).toContainText('Old device OLD-2');
  // An OE gets no Delete, but may edit their own untouched task.
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit task' })).toBeVisible();

  await navigate(page, 'Assigned');
  await expect(page.getByRole('heading', { name: 'Assigned to me' })).toBeVisible();
  await expect(taskItem(page, omId)).toHaveCount(1);
  await expectNoHorizontalScroll(page);
});

test('bulk upload: the sample downloads, the preview shows the bad row, and the 2 valid rows are imported', async ({ page }, testInfo) => {
  const { taskOm, taskOe, client } = readOrg();
  const row = (overrides: Partial<Record<(typeof BULK_TASK_COLUMNS)[number], string>> = {}) => ({
    customer: client,
    site: 'Whitefield depot',
    oe_email: taskOe.email,
    asset_type: 'Vehicle',
    activity: 'New installation',
    vehicle_make: 'Tata',
    vehicle_model: 'Ace',
    installation_type: 'GPS',
    requested_fitment_at: '2026-11-12 09:00',
    fitment_at: '2026-11-13 10:00',
    shift_type: 'Day',
    vehicle_count: '2',
    issue_reported: 'Device not reporting',
    comments: `Bulk ${testInfo.project.name}`,
    ...overrides,
  });
  const rows = [row(), row({ customer: 'Nobody Ltd' }), row({ asset_type: 'Battery', vehicle_make: '', vehicle_model: '', vehicle_count: '4' })];
  const csv = toCsv(
    BULK_TASK_COLUMNS,
    rows.map((r) => BULK_TASK_COLUMNS.map((c) => (r as Record<string, string>)[c] ?? '')),
  );

  await login(page, taskOm.email, taskOm.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${taskOm.name}` })).toBeVisible();
  await navigate(page, 'Bulk upload');
  await expect(page.getByRole('heading', { name: 'Bulk upload' })).toBeVisible();

  const sample = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download sample CSV' }).click();
  expect((await sample).suggestedFilename()).toBe('champ-bulk-tasks-sample.csv');

  await page.getByLabel('Task CSV file').setInputFiles({ name: 'bulk.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByTestId('bulk-summary')).toHaveText('bulk.csv: 2 valid · 1 with errors');
  const items = page.locator('[data-testid="bulk-row"], [data-testid="bulk-card"]').filter({ visible: true });
  await expect(items).toHaveCount(3);
  await expect(items.nth(1)).toHaveAttribute('data-valid', 'false');
  await expect(items.nth(1)).toContainText('customer: No active customer "Nobody Ltd"');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('bulk-preview.png'), fullPage: true });

  const errors = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download error rows (CSV)' }).click();
  expect((await errors).suggestedFilename()).toBe('champ-bulk-tasks-errors.csv');

  await page.getByRole('button', { name: 'Import 2 valid rows' }).click();
  const result = page.getByTestId('bulk-result');
  await expect(result).toContainText('2 task(s) created');
  await expect(result.getByRole('link', { name: /^OM-\d{5}$/ })).toHaveCount(2);
  await result.getByRole('link', { name: /^OM-\d{5}$/ }).last().click();
  await expect(page.getByTestId('fitment-counts')).toHaveText('4 total · 0 assigned · 4 open');
});

test('an RO sees tasks with no actions; the OM deletes an untouched task', async ({ page, browser }, testInfo) => {
  const { ro, taskOm, tasks } = readOrg();
  const task = tasks[testInfo.project.name]!;

  await login(page, ro.email, ro.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${ro.name}` })).toBeVisible();
  await navigate(page, 'Open tasks');
  await expect(page.getByRole('heading', { name: 'Open tasks' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create task' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Bulk upload' })).toHaveCount(0);
  await page.getByLabel('Search tasks').fill(task.omId);
  await taskItem(page, task.omId).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: task.omId })).toBeVisible();
  await expect(page.getByTestId('fitment-counts')).toHaveText('2 total · 0 assigned · 2 open');
  await expect(page.getByRole('link', { name: 'Edit task' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Edit vehicle/ })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await page.goto('/tasks/new');
  await expect(page.getByText("You don't have access to that page")).toBeVisible();

  const omContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const omPage = await omContext.newPage();
  await login(omPage, taskOm.email, taskOm.password);
  await expect(omPage.getByRole('heading', { name: `Welcome, ${taskOm.name}` })).toBeVisible();
  await omPage.goto(`/tasks/${task.id}`);
  await omPage.getByRole('button', { name: 'Delete' }).click();
  await expect(omPage.getByRole('alertdialog')).toContainText(`Delete ${task.omId}?`);
  await omPage.getByRole('alertdialog').getByRole('button', { name: 'Delete task' }).click();
  await expect(omPage.getByRole('heading', { name: 'Open tasks' })).toBeVisible();
  await omPage.getByLabel('Search tasks').fill(task.omId);
  await expect(omPage.getByText('No tasks found.')).toBeVisible();
  await omContext.close();

  // The RO's view of the deleted task is gone too.
  await page.goto(`/tasks/${task.id}`);
  await expect(page.getByText('This task does not exist or was deleted.')).toBeVisible();
});
