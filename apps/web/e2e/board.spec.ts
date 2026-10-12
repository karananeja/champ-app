import { expect, test, type Locator, type Page } from '@playwright/test';
import { login, navigate, pickSearchable, readOrg, taskTabs, type BoardTask } from './helpers';

/**
 * F07: the OM kanban board. Desktop: real pointer drags (mouse down, move in steps, up) and one keyboard drag.
 * 360 px: one column at a time and the "Move to…" menu. Each scenario filters the board to its own task (by OM
 * id), so other specs' fitments don't get in the way.
 */

const isMobile = (name: string) => name === 'mobile-360';

const column = (page: Page, status: string) => page.locator(`[data-testid="board-column"][data-status="${status}"]`);
const card = (page: Page, tkId: string) => page.locator(`[data-testid="board-card"][data-tk="${tkId}"]`);
const handle = (page: Page, tkId: string) => card(page, tkId).getByRole('button', { name: new RegExp(`^${tkId},`) });

async function openBoard(page: Page, task: BoardTask) {
  await page.goto(`/tasks/board?q=${task.omId}`);
  await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="board-card"]')).toHaveCount(task.tkIds.length);
}

async function signIn(page: Page, project: string) {
  const { f07 } = readOrg();
  const om = f07.oms[project]!;
  await login(page, om.email, om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${om.name}` })).toBeVisible();
  return f07.tasks[project]!;
}

/** A real pointer drag: press on the card, move to the target in steps, release. */
async function dragTo(page: Page, from: Locator, to: Locator) {
  await to.scrollIntoViewIfNeeded();
  await from.scrollIntoViewIfNeeded();
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 5, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 40), { steps: 12 });
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  await page.mouse.up();
}

/** Phones: show a column with the picker, then use the card's "Move to…" menu. */
async function moveTo(page: Page, from: string, tkId: string, target: string) {
  await page.getByRole('combobox', { name: 'Column' }).click();
  await page.getByRole('option', { name: new RegExp(`^${from} \\(`) }).click();
  await expect(card(page, tkId)).toBeInViewport();
  await page.getByRole('button', { name: `Move ${tkId} to…` }).click();
  await page.getByRole('menuitem', { name: target, exact: true }).click();
}

async function chooseTechnician(page: Page, technician: string) {
  const dialog = page.getByRole('dialog');
  await pickSearchable(page, dialog.getByRole('combobox', { name: 'Technician' }), technician.split(' ')[0]!, new RegExp(technician));
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('Open → Assigned asks for the technician; the task page agrees', async ({ page }, testInfo) => {
  const tasks = await signIn(page, testInfo.project.name);
  const { wfTechs } = readOrg();
  const task = tasks.assign;
  const tk = task.tkIds[0]!;
  if (!isMobile(testInfo.project.name)) {
    // The Board tab of the Tasks page (CR-10).
    await navigate(page, 'Board');
    await expect(page.getByRole('heading', { name: 'Board', exact: true })).toBeVisible();
    await expect(page.getByTestId('finished-note')).toBeVisible();
  }
  await openBoard(page, task);
  await expect(column(page, 'OPEN').getByTestId('column-count')).toHaveText('1');

  if (isMobile(testInfo.project.name)) await moveTo(page, 'Open', tk, 'Assigned');
  else await dragTo(page, handle(page, tk), column(page, 'ASSIGNED'));
  await expect(page.getByRole('dialog', { name: `Assign ${tk}` })).toBeVisible();
  await chooseTechnician(page, wfTechs[0]!);
  await expect(card(page, tk)).toHaveAttribute('data-status', 'ASSIGNED');
  await expect(card(page, tk).getByTestId('board-card-technician')).toHaveText(wfTechs[0]!);
  await expect(page.getByText(`Assigned ${tk} to ${wfTechs[0]}`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('board-assigned.png'), fullPage: true });

  await page.goto(`/tasks/${task.id}`);
  await expect(page.locator(`[data-tk="${tk}"]`).filter({ visible: true })).toHaveAttribute('data-status', 'ASSIGNED');
});

test('keyboard drag: Space, arrow, Space moves an Open card to Assigned', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'Phones use the "Move to…" menu');
  const tasks = await signIn(page, testInfo.project.name);
  const { wfTechs } = readOrg();
  const tk = tasks.keyboard.tkIds[0]!;
  await openBoard(page, tasks.keyboard);
  await handle(page, tk).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('drag-overlay')).toBeVisible();
  // The sensor starts listening for the arrows a tick after the pick-up; a key pressed sooner is ignored.
  const announcement = page.getByTestId('keyboard-announcement');
  await expect(async () => {
    if ((await announcement.textContent()) !== 'Over Assigned.') await page.keyboard.press('ArrowRight');
    await expect(announcement).toHaveText('Over Assigned.', { timeout: 500 });
  }).toPass();
  await expect(column(page, 'IN_PROGRESS')).toHaveAttribute('aria-disabled', 'true');
  await expect(column(page, 'ASSIGNED')).not.toHaveAttribute('aria-disabled');
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: `Assign ${tk}` })).toBeVisible();
  await chooseTechnician(page, wfTechs[0]!);
  await expect(card(page, tk)).toHaveAttribute('data-status', 'ASSIGNED');
});

test('two selected OE-verified cards are final-approved in one move', async ({ page }, testInfo) => {
  const tasks = await signIn(page, testInfo.project.name);
  const task = tasks.approve;
  const [a, b] = task.tkIds as [string, string];
  await openBoard(page, task);
  if (isMobile(testInfo.project.name)) {
    await page.getByRole('combobox', { name: 'Column' }).click();
    await page.getByRole('option', { name: /^OE verified \(/ }).click();
  }
  await card(page, a).getByRole('checkbox', { name: `Select ${a}` }).click();
  await card(page, b).getByRole('checkbox', { name: `Select ${b}` }).click();
  await expect(page.getByTestId('board-selection')).toContainText('2 selected in OE verified');

  if (isMobile(testInfo.project.name)) {
    await page.getByRole('button', { name: `Move ${b} to…` }).click();
    await page.getByRole('menuitem', { name: 'OM approved', exact: true }).click();
  } else {
    await expect(column(page, 'OE_VERIFIED').getByTestId('column-count')).toHaveText('2');
    await dragTo(page, handle(page, b), column(page, 'OM_APPROVED'));
    await expect(page.getByTestId('drag-overlay')).toBeHidden();
  }
  const confirm = page.getByRole('alertdialog', { name: 'Final approve 2 fitments?' });
  await confirm.getByRole('button', { name: 'Final approve' }).click();
  await expect(card(page, a)).toHaveAttribute('data-status', 'OM_APPROVED');
  await expect(card(page, b)).toHaveAttribute('data-status', 'OM_APPROVED');
  await expect(page.getByText('Final-approved 2 fitments')).toBeVisible();
  await expect(column(page, 'OM_APPROVED').getByTestId('column-count')).toHaveText('2');
});

test('moving to Reopened asks for a reason and raises the reopen count', async ({ page }, testInfo) => {
  const tasks = await signIn(page, testInfo.project.name);
  const tk = tasks.reopen.tkIds[0]!;
  await openBoard(page, tasks.reopen);
  if (isMobile(testInfo.project.name)) {
    await moveTo(page, 'Submitted', tk, 'Reopened');
  } else {
    // Reopened is a side lane: collapsed by default, still a drop target.
    await dragTo(page, handle(page, tk), column(page, 'REOPENED'));
  }
  const dialog = page.getByRole('dialog', { name: `Reopen ${tk}?` });
  await dialog.getByLabel('Reason for reopening').fill('Wiring photo missing');
  await dialog.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`Reopened ${tk}`, { exact: true })).toBeVisible();
  if (!isMobile(testInfo.project.name)) await page.getByRole('button', { name: /^Other/ }).click();
  else {
    await page.getByRole('combobox', { name: 'Column' }).click();
    await page.getByRole('option', { name: /^Reopened \(/ }).click();
  }
  await expect(card(page, tk)).toHaveAttribute('data-status', 'REOPENED');
  await expect(card(page, tk).getByTestId('reopen-chip')).toHaveText('Reopened ×1');
});

test('a forbidden move is refused with the reason (desktop: the card snaps back; phones: not offered)', async ({ page }, testInfo) => {
  const tasks = await signIn(page, testInfo.project.name);
  const tk = tasks.forbidden.tkIds[0]!;
  await openBoard(page, tasks.forbidden);
  if (isMobile(testInfo.project.name)) {
    await page.getByRole('combobox', { name: 'Column' }).click();
    await page.getByRole('option', { name: /^Assigned \(/ }).click();
    await page.getByRole('button', { name: `Move ${tk} to…` }).click();
    await expect(page.getByRole('menuitem')).toHaveText(['Open']);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    return;
  }
  await dragTo(page, handle(page, tk), column(page, 'SUBMITTED'));
  await expect(page.getByText('Only the technician can start or submit work')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(card(page, tk)).toHaveAttribute('data-status', 'ASSIGNED');
  await expect(column(page, 'ASSIGNED').locator(`[data-tk="${tk}"]`)).toBeVisible();
});

test('a simulator step elsewhere shows on the board after a refetch (tab focus)', async ({ page }, testInfo) => {
  const tasks = await signIn(page, testInfo.project.name);
  const task = tasks.refetch;
  const tk = task.tkIds[0]!;
  await openBoard(page, task);
  await expect(card(page, tk)).toHaveAttribute('data-status', 'ASSIGNED');

  // Another actor (the dev simulator, as this OM) starts the work through the API.
  const session = await page.request.post('/api/auth/refresh');
  expect(session.ok()).toBeTruthy();
  const { accessToken } = (await session.json()) as { accessToken: string };
  const res = await page.request.post(`/api/dev/fitments/${task.fitmentIds[0]}/simulate`, {
    data: { action: 'START' },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(res.ok(), await res.text()).toBeTruthy();

  // Returning to the tab refetches the board.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expect(card(page, tk)).toHaveAttribute('data-status', 'IN_PROGRESS');
});

test('the quick view opens from a card and links to the task', async ({ page }, testInfo) => {
  const tasks = await signIn(page, testInfo.project.name);
  const task = tasks.forbidden;
  const tk = task.tkIds[0]!;
  await openBoard(page, task);
  if (isMobile(testInfo.project.name)) {
    await page.getByRole('combobox', { name: 'Column' }).click();
    await page.getByRole('option', { name: /^Assigned \(/ }).click();
  }
  await handle(page, tk).click();
  const sheet = page.getByTestId('board-quick-view');
  await expect(sheet.getByRole('heading', { name: tk })).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Change technician' })).toBeVisible();
  await sheet.getByRole('link', { name: `Open task ${task.omId}` }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${task.id}$`));
  await expect(page.getByRole('heading', { name: task.omId })).toBeVisible();
});

test('non-OM roles get the 403 page and no Board tab', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo.project.name), 'Role check once is enough');
  const { f07 } = readOrg();
  await login(page, f07.oe.email, f07.oe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${f07.oe.name}` })).toBeVisible();
  await navigate(page, 'Open tasks');
  await expect(taskTabs(page).getByRole('link', { name: 'Open', exact: true })).toBeVisible();
  await expect(taskTabs(page).getByRole('link', { name: 'Board', exact: true })).toHaveCount(0);
  await page.goto('/tasks/board');
  await expect(page.getByTestId('forbidden-page')).toBeVisible();
});
