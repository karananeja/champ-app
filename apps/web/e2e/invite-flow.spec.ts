import { expect, test } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  acceptInvite,
  createInvite,
  expectNoHorizontalScroll,
  login,
  navigate,
} from './helpers';

test('SA invites an OM, who sets a password and lands on the dashboard', async ({ page, context }, testInfo) => {
  const omEmail = `om.${testInfo.project.name}.${Date.now()}@intellicar.in`;

  // Google sign-in is hidden when GOOGLE_CLIENT_ID is empty.
  await page.goto('/login');
  await expect(page.getByTestId('google-signin')).toHaveCount(0);

  // Wrong credentials show an error.
  await login(page, ADMIN_EMAIL, 'wrong-password1');
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');

  // The seeded SA signs in.
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByRole('heading', { name: 'Welcome, Super Admin' })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await navigate(page, 'Users');
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  const link = await createInvite(page, omEmail, 'Operations Manager');
  await expectNoHorizontalScroll(page);

  // The pending invite is listed on the Invites tab.
  await page.getByRole('tab', { name: 'Invites' }).click();
  await expect(page.getByText(omEmail).filter({ visible: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('invites-tab.png') });

  // The OM opens the link in another tab and sets a password.
  const omPage = await context.newPage();
  await acceptInvite(omPage, link, 'Olivia Manager', 'Manager123');
  await expect(omPage.getByRole('heading', { name: 'Welcome, Olivia Manager' })).toBeVisible();
  await expect(omPage.getByText('Operations Manager').first()).toBeVisible();
  await expectNoHorizontalScroll(omPage);

  // The link can't be used twice.
  const reusePage = await context.newPage();
  await reusePage.goto(link);
  await expect(reusePage.getByText('This invite has already been used')).toBeVisible();

  // An unknown token shows a clear error too.
  await reusePage.goto('/accept-invite?token=not-a-real-token');
  await expect(reusePage.getByText('This invite link is not valid')).toBeVisible();
});
