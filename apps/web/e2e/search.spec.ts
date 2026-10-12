import { expect, test, type Page } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, expectNoHorizontalScroll, fitmentItem, login, navigate, readOrg } from './helpers';

/** Opens the search dialog: the top-bar button on desktop, the search icon on phones, or Ctrl K. */
async function openSearch(page: Page) {
  const desktop = page.getByRole('button', { name: /^Search ids/ });
  await ((await desktop.isVisible()) ? desktop : page.getByRole('button', { name: 'Search', exact: true })).click();
  const dialog = page.getByRole('dialog', { name: 'Search' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Sets the TK id switch on the settings page and saves. */
async function setTkSearch(page: Page, on: boolean) {
  await navigate(page, 'Search identifiers');
  await expect(page.getByRole('heading', { name: 'Search identifiers' })).toBeVisible();
  const tk = page.getByRole('switch', { name: 'TK id' });
  await expect(tk).toBeVisible();
  if ((await tk.isChecked()) !== on) await tk.click();
  const save = page.getByRole('button', { name: 'Save' });
  if (await save.isEnabled()) {
    await save.click();
    await expect(page.getByText('Search identifiers saved')).toBeVisible();
  }
  await expect(tk).toBeChecked({ checked: on });
}

/**
 * F14: the SA finds a fitment by its TK id from the top-bar search (Ctrl K on desktop, the full-screen dialog on
 * phones) and opens its verification sheet; with *TK id* switched off in Settings the same search finds nothing.
 */
test('global search finds a fitment by TK id and honours the identifier settings', async ({ page }, testInfo) => {
  const { id, omId, tkIds } = readOrg().workflow[testInfo.project.name]!.bulk;
  const tk = tkIds[0]!;
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expect(page.getByRole('heading', { name: /^Welcome/ })).toBeVisible();

  // Ctrl K from anywhere on desktop.
  let dialog: Awaited<ReturnType<typeof openSearch>>;
  if (testInfo.project.name === 'desktop') {
    await page.keyboard.press('Control+k');
    dialog = page.getByRole('dialog', { name: 'Search' });
    await expect(dialog).toBeVisible();
  } else {
    dialog = await openSearch(page);
  }
  const input = dialog.getByRole('combobox', { name: 'Search ids' });
  await input.fill('tk');
  await expect(dialog.getByText('Type at least 3 characters')).toBeVisible();
  await input.fill(tk.toLowerCase().replace('-', ' '));
  const fitment = dialog.getByTestId('search-fitment').filter({ hasText: tk });
  await expect(fitment).toBeVisible();
  await expect(dialog.getByTestId('search-task').filter({ hasText: omId })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('search-dialog.png') });

  await fitment.click();
  await expect(page).toHaveURL(new RegExp(`/tasks/${id}$`));
  const sheet = page.getByRole('dialog', { name: new RegExp(tk) });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('heading', { name: omId })).toBeVisible();
  await expect(fitmentItem(page, tk)).toBeVisible();

  // TK id off: the same search finds nothing. Switched back on at the end.
  await setTkSearch(page, false);
  try {
    dialog = await openSearch(page);
    await dialog.getByRole('combobox', { name: 'Search ids' }).fill(tk);
    await expect(dialog.getByText(`No matches for “${tk}”`)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  } finally {
    await setTkSearch(page, true);
  }
});
