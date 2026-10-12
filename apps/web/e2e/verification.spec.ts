import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  expectNoHorizontalScroll,
  fillVerification,
  fitmentAction,
  fitmentItem,
  login,
  navigate,
  readOrg,
  simulate,
  switchUser,
  taskItem,
} from './helpers';

/** F06: OE verification and image correction, on desktop and at 360 px, with photos in the real MinIO (champ-e2e). */

const SAMPLE_JPEG = fs.readFileSync(path.resolve(import.meta.dirname, '../../api/src/modules/dev/sample-photos/sample-after.jpg'));

async function openTask(page: Page, id: string, omId: string) {
  await page.goto(`/tasks/${id}`);
  await expect(page.getByRole('heading', { name: omId })).toBeVisible();
}

/** The fitment's Photos button (desktop row) or its card menu item (phones). */
async function openPhotos(page: Page, tkId: string) {
  const button = page.getByRole('button', { name: `Photos ${tkId}`, exact: true });
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole('button', { name: `Actions for ${tkId}` }).click();
    await page.getByRole('menuitem', { name: /^Photos \(/ }).click();
  }
  const viewer = page.getByRole('dialog', { name: `Photos · ${tkId}` });
  await expect(viewer).toBeVisible();
  return viewer;
}

/** Every image in `scope` has loaded from storage (presigned MinIO URLs). */
async function expectImagesLoaded(scope: ReturnType<Page['getByRole']>, count: number) {
  const images = scope.getByRole('img');
  await expect(images).toHaveCount(count);
  await expect
    .poll(() => images.evaluateAll((els) => els.filter((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0).length))
    .toBe(count);
}

test('simulated submit → OE verifies with photos, corrects a photo and adds a debug image → OM approves → Completed with Billable and fitment export', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { f06 } = readOrg();
  const { id, omId, tkIds } = f06.tasks[testInfo.project.name]!;
  const tk = tkIds[0]!;

  // 1. Simulated technician submit attaches 5 sample photos and OT remarks (AC1).
  await login(page, f06.oe.email, f06.oe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${f06.oe.name}` })).toBeVisible();
  await openTask(page, id, omId);
  await simulate(page, 'Start work');
  await simulate(page, 'Submit');
  await expect(fitmentItem(page, tk)).toHaveAttribute('data-status', 'SUBMITTED');

  // 2. Verify sheet: OT remarks and photos next to the form (AC2); incomplete → inline errors (AC4).
  await fitmentAction(page, tk, 'Verify');
  const sheet = page.getByTestId('verification-sheet');
  await expect(sheet.getByRole('heading', { name: `Verify ${tk}` })).toBeVisible();
  await expect(sheet.getByTestId('ot-remarks')).toContainText('Sample remarks');
  await expectImagesLoaded(sheet.getByRole('region', { name: "Technician's work" }), 5);
  await sheet.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(sheet.getByTestId('verification-error')).toHaveText('Fill in Issue observed at site, Action taken, Final issue before verifying');

  // Live billable (AC3).
  await fillVerification(page, 'Device fault');
  await expect(sheet.getByTestId('billable-badge')).toHaveText('Billable: No');
  await fillVerification(page, 'Wiring issue');
  await expect(sheet.getByTestId('billable-badge')).toHaveText('Billable: Yes');

  // 3. Debug image: a fake JPEG is refused by the server, a real one is stored (AC8).
  const upload = sheet.getByLabel('Upload a debug image');
  await upload.setInputFiles({ name: 'fake.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('this is not an image') });
  await expect(sheet.getByTestId('upload-error')).toHaveText('Only JPEG, PNG or WebP images can be uploaded');
  await upload.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('plain text') });
  await expect(sheet.getByTestId('upload-error')).toHaveText('Only JPEG, PNG or WebP images can be uploaded');
  await upload.setInputFiles({ name: 'debug.jpg', mimeType: 'image/jpeg', buffer: SAMPLE_JPEG });
  await expect(page.getByText(`Debug image added to ${tk}`)).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Debug image (1)' })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('verify-sheet.png'), fullPage: true });

  await sheet.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(fitmentItem(page, tk)).toHaveAttribute('data-status', 'OE_VERIFIED');
  await expect(fitmentItem(page, tk).getByTestId('fitment-verification')).toContainText('Final issue: Wiring issue');
  await expect(fitmentItem(page, tk).getByTestId('billable-badge')).toHaveText('Billable: Yes');

  // 4. Replace a technician photo with a reason; history shows the original (AC7).
  let viewer = await openPhotos(page, tk);
  await expectImagesLoaded(viewer, 6);
  await viewer.getByRole('button', { name: 'Open After photo' }).click();
  await expect(page.getByRole('button', { name: 'Close photo viewer' })).toBeVisible();
  await page.keyboard.press('Escape'); // closes the lightbox only
  await expect(page.getByRole('button', { name: 'Close photo viewer' })).toBeHidden();
  await expect(viewer).toBeVisible();

  await viewer.getByRole('button', { name: 'Replace Before photo' }).click();
  const replace = page.getByRole('dialog', { name: 'Replace before photo' });
  await replace.getByLabel('Choose the corrected image').setInputFiles({ name: 'before-fixed.jpg', mimeType: 'image/jpeg', buffer: SAMPLE_JPEG });
  await replace.getByLabel('Reason').fill('Blurry; retaken from the depot camera');
  await replace.getByRole('button', { name: 'Replace photo' }).click();
  await expect(replace).toBeHidden();
  await expect(page.getByText('Before photo replaced')).toBeVisible();
  await viewer.getByRole('switch', { name: 'Show history' }).click();
  const original = viewer.locator('[data-testid="photo-item"][data-status="REPLACED"]');
  await expect(original).toHaveCount(1);
  await expect(original.getByTestId('photo-change')).toContainText(`Replaced by ${f06.oe.name}`);
  await expect(original.getByTestId('photo-change')).toContainText('Blurry; retaken from the depot camera');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('photo-history.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // 5. The OM sees the verification on the task page, then final-approves (AC5).
  await switchUser(page, f06.om.email, f06.om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${f06.om.name}` })).toBeVisible();
  await openTask(page, id, omId);
  await expect(fitmentItem(page, tk).getByTestId('fitment-verification')).toContainText('Final issue: Wiring issue');
  await expect(fitmentItem(page, tk).getByTestId('billable-badge')).toHaveText('Billable: Yes');
  await fitmentAction(page, tk, 'Final approve');
  const confirm = page.getByRole('dialog');
  await confirm.getByRole('button', { name: 'Final approve', exact: true }).click();
  await expect(confirm).toBeHidden();
  await expect(fitmentItem(page, tk)).toHaveAttribute('data-status', 'OM_APPROVED');

  // 6. After OM approval the OE can view but no longer replace photos (AC7).
  await switchUser(page, f06.oe.email, f06.oe.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${f06.oe.name}` })).toBeVisible();
  await openTask(page, id, omId);
  await expect(page.getByTestId('task-status')).toHaveText('Completed');
  viewer = await openPhotos(page, tk);
  await expectImagesLoaded(viewer, 6);
  await expect(viewer.getByRole('button', { name: /^Replace/ })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const view = page.getByRole('button', { name: `View verification ${tk}` });
  if (await view.isVisible()) await view.click();
  else {
    await page.getByRole('button', { name: `Actions for ${tk}` }).click();
    await page.getByRole('menuitem', { name: 'View verification' }).click();
  }
  await expect(page.getByTestId('verification-readonly')).toContainText('Wiring issue');
  await page.keyboard.press('Escape');

  // 7. Completed tasks show the Billable column; the fitment-level export downloads (AC9).
  await navigate(page, 'Completed tasks');
  await expect(page.getByRole('heading', { name: 'Completed tasks' })).toBeVisible();
  await page.getByLabel('Search tasks').fill(omId);
  await expect(taskItem(page, omId)).toHaveCount(1);
  await expect(taskItem(page, omId).getByTestId('task-billable')).toHaveText('1 / 1');
  await expectNoHorizontalScroll(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  await page.getByRole('menuitem', { name: 'Fitments (CSV)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^champ-fitments-\d{8}-\d{4}\.csv$/);
  const csv = fs.readFileSync((await file.path())!, 'utf8');
  expect(csv).toContain('Final issue');
  expect(csv).toContain(`${tk},${omId}`);
  expect(csv).toMatch(/Wiring issue,Yes,/);
});
