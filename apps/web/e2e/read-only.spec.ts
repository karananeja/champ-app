import { expect, test } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, acceptInvite, createInvite, login, navigate } from './helpers';

test('a read-only user sees no create, edit or invite actions', async ({ browser, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'covered once on desktop');
  const roEmail = `ro.${Date.now()}@intellicar.in`;

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await navigate(page, 'Users');
  const link = await createInvite(page, roEmail, 'Read Only');

  // The RO uses a separate browser session.
  const roContext = await browser.newContext();
  const roPage = await roContext.newPage();
  await acceptInvite(roPage, link, 'Riya Reader', 'Reader123');
  await expect(roPage.getByRole('heading', { name: 'Welcome, Riya Reader' })).toBeVisible();

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
