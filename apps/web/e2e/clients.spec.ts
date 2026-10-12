import { expect, test, type Page } from '@playwright/test';
import { clientItem, expectNoHorizontalScroll, login, navigate, readOrg, stubMaps } from './helpers';

const siteItem = (page: Page, name: string) => page.getByTestId('site-item').filter({ hasText: name });

test('an OM creates a client with a site via search and pin, adds a second site, and cannot deactivate the last active one', async ({
  page,
}, testInfo) => {
  const { om, locations } = readOrg();
  const name = `Zoom Rentals ${testInfo.project.name} ${Date.now()}`;
  const reverseCalls = await stubMaps(page, {
    search: {
      'mg road': [
        {
          displayName: 'MG Road, Shanthala Nagar, Bengaluru, Karnataka, 560001, India',
          lat: 12.975,
          lng: 77.606,
          city: 'Bengaluru',
          state: 'Karnataka',
          suggestedLocationId: locations.bengaluru,
        },
      ],
      hinjewadi: [
        {
          displayName: 'Hinjewadi Phase 1, Pune, Maharashtra, 411057, India',
          lat: 18.5912,
          lng: 73.7389,
          city: 'Pune',
          state: 'Maharashtra',
          suggestedLocationId: locations.pune,
        },
      ],
    },
    reverse: (lat, lng) => ({
      displayName: `Dropped pin near MG Road (${lat.toFixed(3)}), Bengaluru`,
      lat,
      lng,
      suggestedLocationId: locations.bengaluru,
    }),
  });

  await login(page, om.email, om.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${om.name}` })).toBeVisible();
  await navigate(page, 'Clients');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Add client' }).click();
  await expect(page.getByRole('heading', { name: 'Add client' })).toBeVisible();

  await page.getByLabel('Client name', { exact: true }).fill(name);
  await page.getByLabel('Contact name', { exact: true }).fill('Priya Rao');
  await page.getByLabel('Contact phone', { exact: true }).fill('+91 98765 43210');
  await page.getByLabel('Site name').fill('Bengaluru depot');

  // Search moves the map and sets the pin, address and city.
  await page.getByLabel('Search address').fill('MG Road');
  await page.getByRole('option', { name: /MG Road, Shanthala Nagar/ }).click();
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue(/^MG Road, Shanthala Nagar/);
  await expect(page.getByTestId('site-0-coords')).toHaveText('Pin: 12.97500, 77.60600');
  await expect(page.getByRole('combobox', { name: 'City' })).toHaveText(/Bengaluru, Karnataka/);
  await expect(page.locator('.leaflet-marker-icon')).toHaveCount(1);

  // Dragging the pin updates the coordinates, and the reverse lookup updates the address.
  const marker = page.locator('.leaflet-marker-icon');
  const box = (await marker.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue(/^Dropped pin near MG Road/);
  expect(reverseCalls.length).toBeGreaterThan(0);
  const pinText = (await page.getByTestId('site-0-coords').textContent())!;
  expect(pinText).not.toBe('Pin: 12.97500, 77.60600');
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByTestId('sites-map').locator('.leaflet-marker-icon')).toHaveCount(1);
  await expect(siteItem(page, 'Bengaluru depot')).toContainText('Bengaluru, Karnataka');

  // The saved site reopens at the same spot.
  await siteItem(page, 'Bengaluru depot').getByRole('link', { name: 'Edit Bengaluru depot' }).click();
  await expect(page.getByTestId('site-0-coords')).toHaveText(pinText);
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();

  // Add a second site.
  await page.getByRole('link', { name: 'Add site' }).click();
  const card = page.getByTestId('site-card').nth(1);
  await card.getByLabel('Site name').fill('Pune yard');
  await card.getByLabel('Search address').fill('Hinjewadi');
  await page.getByRole('option', { name: /Hinjewadi Phase 1/ }).click();
  await expect(card.getByRole('combobox', { name: 'City' })).toHaveText(/Pune, Maharashtra/);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByTestId('sites-map').locator('.leaflet-marker-icon')).toHaveCount(2);
  await expect(page.getByText('Sites (2/2 active)')).toBeVisible();

  // Deactivate one site: it stays, greyed out.
  await siteItem(page, 'Pune yard').getByRole('switch', { name: 'Deactivate Pune yard' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(siteItem(page, 'Pune yard')).toHaveAttribute('data-active', 'false');
  await expect(page.getByText('Sites (1/2 active)')).toBeVisible();

  // The last active site can't be deactivated.
  await siteItem(page, 'Bengaluru depot').getByRole('switch', { name: 'Deactivate Bengaluru depot' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Deactivate' }).click();
  await expect(page.getByText('A client needs at least one active site. Add or activate another site first.')).toBeVisible();
  await expect(siteItem(page, 'Bengaluru depot')).toHaveAttribute('data-active', 'true');
  await expectNoHorizontalScroll(page);
  await page.screenshot({ path: testInfo.outputPath('client-detail.png') });

  // The list shows the site counts.
  await navigate(page, 'Clients');
  await page.getByLabel('Search clients').fill(name);
  await expect(clientItem(page, name)).toContainText('1/2');
  await expectNoHorizontalScroll(page);
});

test('an OE sees clients and the map with no edit actions', async ({ page }) => {
  const { oeA, client } = readOrg();
  await stubMaps(page, { search: {}, reverse: () => null });

  await login(page, oeA.email, oeA.password);
  await expect(page.getByRole('heading', { name: `Welcome, ${oeA.name}` })).toBeVisible();
  await navigate(page, 'Clients');
  await expect(page.getByRole('heading', { name: 'Clients', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add client' })).toHaveCount(0);

  await page.getByLabel('Search clients').fill(client);
  await clientItem(page, client).getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: client })).toBeVisible();
  await expect(page.getByTestId('sites-map').locator('.leaflet-marker-icon')).toHaveCount(1);
  await expect(page.getByTestId('site-item')).toContainText('Whitefield depot');
  await expect(page.getByRole('link', { name: 'Edit client' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Add site' })).toHaveCount(0);
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /activate client/i })).toHaveCount(0);
  await expectNoHorizontalScroll(page);

  // The edit page isn't reachable either: a direct URL shows the 403 page (CR-03; it used to redirect home).
  await page.goto(page.url() + '/edit');
  await expect(page.getByRole('heading', { name: "You don't have access" })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Edit / })).toHaveCount(0);
});
