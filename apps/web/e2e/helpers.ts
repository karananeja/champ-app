import { expect, type Page } from '@playwright/test';

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
  if (await hamburger.isVisible()) await hamburger.click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label }).click();
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
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const widest = Math.max(
      ...Array.from(document.querySelectorAll('body *'))
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => el.getBoundingClientRect().right),
    );
    return Math.max(document.documentElement.scrollWidth, widest) - width;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}
