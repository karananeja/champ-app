/** CR-01: Masters only for SA/OM (D-059) and the password show/hide toggle (D-060). */
import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, login, readOrg } from './helpers';

/** Opens the hamburger sheet on small screens so the menu can be inspected. */
async function mainNav(page: Page) {
  const hamburger = page.getByRole('button', { name: 'Open menu' });
  if (await hamburger.isVisible()) await hamburger.click();
  const nav = page.getByRole('navigation', { name: 'Main' }).filter({ visible: true });
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  return nav;
}

test('an OE has no Masters menu and is redirected from master URLs', async ({ page }) => {
  const { oeA } = readOrg();
  await login(page, oeA.email, oeA.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${oeA.name}` })).toBeVisible();

  const nav = await mainNav(page);
  await expect(nav.getByRole('link', { name: 'Clients' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'All masters' })).toHaveCount(0);
  await expect(nav.getByText('Masters', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');

  for (const path of ['/masters', '/masters/final-issue']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: `Welcome, ${oeA.name}` })).toBeVisible();
    await expect(page.getByText("You don't have access to that page")).toBeVisible();
  }

  // The API refuses master reads but dropdown values still load.
  const status = await page.evaluate(async () => {
    const refresh = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    const { accessToken } = (await refresh.json()) as { accessToken: string };
    const headers = { Authorization: `Bearer ${accessToken}` };
    return {
      masters: (await fetch('/api/masters/locations', { headers })).status,
      lookups: (await fetch('/api/lookups', { headers })).status,
    };
  });
  expect(status).toEqual({ masters: 403, lookups: 200 });
});

test('the login password field has a show/hide toggle', async ({ page }) => {
  await page.goto('/login');
  const password = page.getByLabel('Password', { exact: true });
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await password.fill('Typed@1234');
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(password).toHaveValue('Typed@1234');
  const hide = page.getByRole('button', { name: 'Hide password' });
  await expect(hide).toHaveAttribute('aria-pressed', 'true');

  await hide.click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Show password' })).toHaveAttribute('aria-pressed', 'false');
  // Toggling never submits the form.
  await expect(page).toHaveURL(/\/login$/);
});
