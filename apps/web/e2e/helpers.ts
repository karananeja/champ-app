import fs from 'node:fs';
import path from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export const ADMIN_EMAIL = process.env.SEED_SUPERADMIN_EMAIL || 'admin@intellicar.in';
export const ADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || 'Admin@1234';

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Uses the sidebar on desktop and the hamburger sheet on small screens. */
export async function navigate(page: Page, label: string) {
  const hamburger = page.getByRole('button', { name: 'Open menu' });
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label });
  // Let a closing dialog finish: it returns focus to its trigger at the end of its exit animation, which
  // would dismiss a menu sheet opened in the meantime.
  await expect(page.locator('[data-slot="dialog-content"], [data-slot="alert-dialog-content"]')).toHaveCount(0);
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
