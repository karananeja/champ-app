import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, acceptInvite, createInvite, login, navigate } from './helpers';

test('a read-only user sees no create, edit or invite actions and no Masters', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'covered once on desktop');
  const roEmail = `ro.${Date.now()}@intellicar.in`;

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await navigate(page, 'Users');
  const link = await createInvite(page, roEmail, 'Read Only');

  // The RO uses a separate browser session.
  const roContext = await browser.newContext();
  const roPage = await roContext.newPage();

  // CR-01: on accept-invite, password and confirm password each have their own show/hide toggle.
  await roPage.goto(link);
  const password = roPage.getByLabel('Password', { exact: true });
  const confirm = roPage.getByLabel('Confirm password');
  await password.fill('Reader123');
  await confirm.fill('Reader123');
  const toggles = roPage.getByRole('button', { name: /^(Show|Hide) password$/ });
  await expect(toggles).toHaveCount(2);
  await toggles.nth(0).click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(confirm).toHaveAttribute('type', 'password');
  await toggles.nth(1).click();
  await expect(confirm).toHaveAttribute('type', 'text');
  await toggles.nth(0).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(confirm).toHaveAttribute('type', 'text');

  await acceptInvite(roPage, link, 'Riya Reader', 'Reader123');
  await expect(roPage.getByRole('heading', { name: 'Welcome, Riya Reader' })).toBeVisible();

  // CR-01: no Masters menu, and master URLs redirect to the dashboard with a message.
  const nav = roPage.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'All masters' })).toHaveCount(0);
  for (const path of ['/masters', '/masters/final-issue']) {
    await roPage.goto(path);
    await expect(roPage.getByRole('heading', { name: 'Welcome, Riya Reader' })).toBeVisible();
    await expect(roPage).toHaveURL(/\/$/);
    await expect(roPage.getByText("You don't have access to that page")).toBeVisible();
  }

  await navigate(roPage, 'Users');
  await expect(roPage.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(roPage.getByTestId('user-row').first()).toBeVisible();
  await expect(roPage.getByRole('button', { name: 'Invite user' })).toHaveCount(0);
  await expect(roPage.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
  await expect(roPage.getByRole('tab', { name: 'Invites' })).toHaveCount(0);

  // The session survives a reload (refresh cookie).
  await roPage.reload();
  await expect(roPage.getByRole('heading', { name: 'Users' })).toBeVisible();

  // Logout returns to the login page; protected routes redirect there.
  await roPage.getByRole('button', { name: 'User menu' }).click();
  await roPage.getByRole('menuitem', { name: 'Log out' }).click();
  await expect(roPage).toHaveURL(/\/login$/);
  await roPage.goto('/users');
  await expect(roPage).toHaveURL(/\/login$/);
  await roContext.close();
});
