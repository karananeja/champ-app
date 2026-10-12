import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'admin@intellicar.in';
export const ADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@1234';

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  // exact: the eye toggle's "Show password" label would match too (CR-01).
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Uses the sidebar on desktop and the hamburger sheet on small screens. */
export async function navigate(page: Page, label: string) {
  const hamburger = page.getByRole('button', { name: 'Open menu' });
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label });
  // Let a closing dialog or dropdown menu finish: it returns focus to its trigger at the end of its exit
  // animation, which would dismiss a menu sheet opened in the meantime.
  await expect(
    page.locator('[data-slot="dialog-content"], [data-slot="alert-dialog-content"], [data-slot="dropdown-menu-content"]'),
  ).toHaveCount(0);
  if (await hamburger.isVisible()) {
    await expect(async () => {
      if (!(await link.isVisible())) await hamburger.click();
      await expect(link).toBeVisible({ timeout: 1000 });
    }).toPass();
  }
  await link.click();
}

/** Opens the invite dialog, creates an invite and returns the one-time link. */
export async function createInvite(page: Page, email: string, roleLabel: string) {
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('combobox', { name: 'Role' }).click();
  await page.getByRole('option', { name: roleLabel }).click();
  await dialog.getByRole('button', { name: 'Create invite' }).click();

  await expect(dialog.getByText('This link is shown only once and expires in 72 hours')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  const link = await dialog.getByLabel('Invite link').inputValue();
  expect(link).toContain('/accept-invite?token=');
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  return link;
}

export async function acceptInvite(page: Page, link: string, name: string, password: string) {
  await page.goto(link);
  await expect(page.getByText('Set up your account')).toBeVisible();
  await page.getByLabel('Full name').fill(name);
  await page.getByLabel('Phone').fill('+91 98765 43210');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
}

export async function expectNoHorizontalScroll(page: Page) {
  // Also catch content that is clipped by an overflowing child rather than scrolling the page.
  const { overflow, culprits } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    // Map tiles and panes extend past the map, but the map container clips them (overflow: hidden).
    const visible = Array.from(document.querySelectorAll('body *')).filter(
      (el) => el.getClientRects().length > 0 && !el.closest('.leaflet-container'),
    );
    const widest = Math.max(...visible.map((el) => el.getBoundingClientRect().right));
    const culprits = visible
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 80)} (${el.textContent?.slice(0, 40)})`);
    return { overflow: Math.max(document.documentElement.scrollWidth, widest) - width, culprits };
  });
  expect(overflow, `overflowing: ${culprits.join(' | ')}`).toBeLessThanOrEqual(1);
}

// --- F02 ---

export const ORG_FILE = path.resolve(import.meta.dirname, '.data/org.json');

interface Account {
  email: string;
  name: string;
  password: string;
}

/** The org created by `org.setup.ts`. */
export interface E2eOrg {
  om: Account;
  oeA: Account;
  oeB: Account;
  /** Technician names (OTs reporting to oeA and oeB). */
  techA: string;
  techB: string;
  /** F03: a client (one active site) created by the SA. */
  client: string;
  /** F03: location ids used as geocoder suggestions. */
  locations: { bengaluru: string; pune: string };
  /** F04: dedicated accounts for the task specs (the OE reports to taskOm). */
  taskOm: Account;
  taskOe: Account;
  ro: Account;
  /** F04: one untouched task per Playwright project (2 vehicles, OE = taskOe), for delete/read-only checks. */
  tasks: Record<string, { id: string; omId: string }>;
  /** F05: workflow accounts (the OE reports to wfOm) and technician names (OTs of wfOe). */
  wfOm: Account;
  wfOe: Account;
  wfTechs: string[];
  /**
   * F05: per Playwright project, tasks assigned to wfTechs[0] (OE = wfOe): `flow`, `reopen` and `faulty` with
   * one fitment, `bulk` with two fitments already OE verified.
   */
  workflow: Record<string, Record<'flow' | 'reopen' | 'faulty' | 'bulk', WorkflowTask>>;
  /**
   * CR-03/CR-04: own OM/OE/RO accounts and, per Playwright project, the OM ids of a Completed task and of an
   * Open task with its fitment on 15 Mar 2027 (IST).
   */
  cr: { om: Account; oe: Account; ro: Account; tasks: Record<string, { completed: string; march: string }> };
  /** F06: own OM/OE accounts and, per Playwright project, one task (1 fitment, technician wfTechs[0], OE = f06.oe). */
  f06: { om: Account; oe: Account; tasks: Record<string, WorkflowTask> };
  /** F07: a board OM per Playwright project, an OE, and per project one task per board scenario (see org.setup.ts). */
  f07: {
    oms: Record<string, Account>;
    oe: Account;
    tasks: Record<string, Record<'assign' | 'keyboard' | 'approve' | 'reopen' | 'forbidden' | 'refetch', BoardTask>>;
  };
  /** F08: per Playwright project a travel OM, an OE reporting to them and the OE's only technician; one RO. */
  f08: { projects: Record<string, { om: Account; oe: Account; technician: string }>; ro: Account };
}

export interface BoardTask extends WorkflowTask {
  fitmentIds: string[];
}

export interface WorkflowTask {
  id: string;
  omId: string;
  tkIds: string[];
}

export const readOrg = (): E2eOrg => JSON.parse(fs.readFileSync(ORG_FILE, 'utf8')) as E2eOrg;

/** The visible row (desktop table) or card (small screens) of a master list that contains `text`. */
export const masterItem = (page: Page, text: string): Locator =>
  page
    .locator('[data-testid="master-row"], [data-testid="master-card"]')
    .filter({ hasText: text, visible: true });

/** The visible technician row or card that contains `text`. */
export const technicianItem = (page: Page, text: string): Locator =>
  page
    .locator('[data-testid="technician-row"], [data-testid="technician-card"]')
    .filter({ hasText: text, visible: true });

/** Opens a master from the Masters landing page. */
export async function openMaster(page: Page, title: string) {
  await navigate(page, 'All masters');
  await expect(page.getByRole('heading', { name: 'Masters', exact: true })).toBeVisible();
  await page.getByRole('link', { name: new RegExp(`^${title}`) }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
}

/** Picks an option in a searchable select (Command + Popover). */
export async function pickSearchable(page: Page, combobox: Locator, search: string, option: string | RegExp) {
  await combobox.click();
  await page.getByPlaceholder(/^Search/).last().fill(search);
  await page.getByRole('option', { name: option }).click();
}

// --- F03 ---

/** The visible client row (desktop table) or card (small screens) that contains `text`. */
export const clientItem = (page: Page, text: string): Locator =>
  page.locator('[data-testid="client-row"], [data-testid="client-card"]').filter({ hasText: text, visible: true });

/** A 1×1 transparent PNG served instead of real OpenStreetMap tiles. */
const BLANK_TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export interface StubPlace {
  displayName: string;
  lat: number;
  lng: number;
  city?: string;
  state?: string;
  suggestedLocationId?: string;
}

/**
 * Stubs geocoding (`/api/geo/*`, so the API never calls Nominatim) and the OSM tile server. `search` maps a
 * query substring to results; reverse returns `reverse(lat, lng)`. Returns the reverse calls seen.
 */
export async function stubMaps(
  page: Page,
  options: { search: Record<string, StubPlace[]>; reverse: (lat: number, lng: number) => StubPlace | null },
) {
  const reverseCalls: { lat: number; lng: number }[] = [];
  await page.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: BLANK_TILE }),
  );
  await page.route('**/api/geo/search?**', (route) => {
    const q = (new URL(route.request().url()).searchParams.get('q') ?? '').toLowerCase();
    const key = Object.keys(options.search).find((k) => q.includes(k.toLowerCase()));
    return route.fulfill({ json: { items: key ? options.search[key] : [] } });
  });
  await page.route('**/api/geo/reverse?**', (route) => {
    const url = new URL(route.request().url());
    const lat = Number(url.searchParams.get('lat'));
    const lng = Number(url.searchParams.get('lng'));
    reverseCalls.push({ lat, lng });
    return route.fulfill({ json: { item: options.reverse(lat, lng) } });
  });
  return reverseCalls;
}

// --- F04 ---

/** The visible task row (desktop table) or card (small screens) that contains `text`. */
export const taskItem = (page: Page, text: string): Locator =>
  page.locator('[data-testid="task-row"], [data-testid="task-card"]').filter({ hasText: text, visible: true });

/** The visible fitment rows (table) or cards (small screens). */
export const fitmentItems = (page: Page): Locator =>
  page.locator('[data-testid="fitment-row"], [data-testid="fitment-card"]').filter({ visible: true });

// --- F05 ---

/** The visible fitment row or card of a TK id (by `data-tk`; a replacement's row also mentions the original's TK). */
export const fitmentItem = (page: Page, tkId: string): Locator => fitmentItems(page).and(page.locator(`[data-tk="${tkId}"]`));

/** Runs a fitment review action: the row button on desktop, the card's actions menu on small screens. */
export async function fitmentAction(page: Page, tkId: string, action: 'Verify' | 'Final approve' | 'Reopen') {
  const button = page.getByRole('button', { name: `${action} ${tkId}`, exact: true });
  if (await button.isVisible()) {
    await button.click();
  } else {
    await page.getByRole('button', { name: `Actions for ${tkId}` }).click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  }
}

/**
 * F06: opens the verification sheet of a fitment (the Verify button), fills the required fields with seeded
 * masters (and the given final issue), checks the live billable badge and verifies.
 */
export async function verifyInSheet(page: Page, tkId: string, finalIssue = 'Wiring issue', billable = 'Yes') {
  await fitmentAction(page, tkId, 'Verify');
  const sheet = page.getByTestId('verification-sheet');
  await expect(sheet.getByRole('heading', { name: `Verify ${tkId}` })).toBeVisible();
  await fillVerification(page, finalIssue);
  await expect(sheet.getByTestId('billable-badge')).toHaveText(`Billable: ${billable}`);
  await sheet.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(sheet).toBeHidden();
}

/** F06: fills the three required verification fields in the open sheet. */
export async function fillVerification(page: Page, finalIssue = 'Wiring issue') {
  const sheet = page.getByTestId('verification-sheet');
  await pickSearchable(page, sheet.getByRole('combobox', { name: /^Issue observed at site/ }), 'Loose', 'Loose wiring');
  await pickSearchable(page, sheet.getByRole('combobox', { name: /^Action taken/ }), 'Rewired', 'Rewired power supply');
  await pickSearchable(page, sheet.getByRole('combobox', { name: /^Final issue/ }), finalIssue, finalIssue);
}

/** Opens the dev simulator panel on a task page and runs a technician step (Start work or Submit). */
export async function simulate(page: Page, step: 'Start work' | 'Submit') {
  const panel = page.getByTestId('simulator-panel');
  if (!(await panel.getByRole('button', { name: 'Start work' }).isVisible())) {
    await panel.getByRole('button', { name: /Simulate technician \(dev only\)/ }).click();
  }
  const button = panel.getByRole('button', { name: step, exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText(/\(simulated\)$/).last()).toBeVisible();
}

/** Signs out by dropping the session cookie, so the next `login` starts clean. */
export async function switchUser(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await login(page, email, password);
}

// --- CR-04: date pickers (Calendar + Popover) ---

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** In the open calendar popover, goes to the month of `day` (`YYYY-MM-DD`) and clicks that day. */
export async function chooseCalendarDay(page: Page, day: string) {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const target = y * 12 + (m - 1);
  const dialog = page.getByRole('dialog');
  for (let i = 0; i < 600; i++) {
    const [name, year] = ((await dialog.getByRole('grid').getAttribute('aria-label')) ?? '').split(' ');
    const current = Number(year) * 12 + MONTHS.indexOf(name ?? '');
    if (current === target) break;
    await dialog.getByRole('button', { name: current < target ? 'Go to the Next Month' : 'Go to the Previous Month' }).click();
  }
  await dialog
    .getByRole('grid')
    .getByRole('button', { name: new RegExp(`${MONTHS[m - 1]} ${d}(st|nd|rd|th), ${y}`) })
    .click();
}

/** Opens a DateTimePicker (its trigger) and picks `value` (`YYYY-MM-DDTHH:mm`, IST): day, hour, minute, Done. */
export async function pickDateTime(page: Page, trigger: Locator, value: string) {
  const [day, time] = value.split('T') as [string, string];
  const [hour, minute] = time.split(':') as [string, string];
  await trigger.click();
  await chooseCalendarDay(page, day);
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Hour (IST)' }).click();
  await page.getByRole('option', { name: hour, exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Minute' }).click();
  await page.getByRole('option', { name: minute, exact: true }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
}

/** Opens a DateRangePicker (its trigger) and picks `from` then `to` (`YYYY-MM-DD`), then Done. */
export async function pickDateRange(page: Page, trigger: Locator, from: string, to: string) {
  await trigger.click();
  await chooseCalendarDay(page, from);
  await chooseCalendarDay(page, to);
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

// --- F08 ---

/** The visible travel task row (desktop table) or card (small screens) that contains `text`. */
export const travelItem = (page: Page, text: string): Locator =>
  page.locator('[data-testid="travel-row"], [data-testid="travel-card"]').filter({ hasText: text, visible: true });

/** Opens the detail sheet of a TT from the list (its id button on desktop, the card on phones). */
export async function openTravel(page: Page, ttId: string) {
  const item = travelItem(page, ttId);
  await expect(item).toHaveCount(1);
  // Desktop: the id button in the row; phones: the whole card is a button named "Open TT-…".
  await item.getByRole('button', { name: new RegExp(`^(Open )?${ttId}$`) }).filter({ visible: true }).first().click();
  await expect(page.getByTestId('travel-detail').getByRole('heading', { name: ttId })).toBeVisible();
}
