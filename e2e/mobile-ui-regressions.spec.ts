import { expect, test } from '@playwright/test';

test.describe('regressioni UI mobile dagli screenshot', () => {
  test.beforeEach(({ page }) => {
    test.skip((page.viewportSize()?.width ?? 9999) > 720, 'Contratto specifico mobile');
  });

  test('i tre collegamenti del profilo restano visibili e contenuti', async ({ page }) => {
    await page.goto('/profilo/', { waitUntil: 'domcontentloaded' });

    const navigation = page.locator('aside[aria-label="Sezioni del profilo"] nav');
    const links = navigation.locator('a');
    await expect(navigation).toBeVisible();
    await expect(links).toHaveCount(3);
    await expect(links.nth(2)).toHaveText('Privacy e controllo');

    const geometry = await navigation.evaluate((element) => {
      const navigationRect = element.getBoundingClientRect();
      const linkRects = [...element.querySelectorAll('a')].map((link) => link.getBoundingClientRect());
      return {
        noInternalOverflow: element.scrollWidth <= element.clientWidth + 1,
        linksInside: linkRects.every((rect) => (
          rect.left >= navigationRect.left - 1
          && rect.right <= navigationRect.right + 1
          && rect.height >= 44
        )),
        noPageOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      };
    });

    expect(geometry).toEqual({
      noInternalOverflow: true,
      linksInside: true,
      noPageOverflow: true,
    });
  });

  test('profilo e ultimo podio usano controlli compatti senza testo troncato', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('tre-milano:taste-profile:v1', JSON.stringify({
        version: 1,
        state: 'active',
        preferences: { atmosphere: 4 },
        interests: ['Rooftop', 'Aperitivo'],
      }));
      const createdAt = Date.now();
      localStorage.setItem('tre-milano:last-podium:v1', JSON.stringify({
        version: 1,
        createdAt,
        expiresAt: createdAt + (4 * 60 * 60 * 1000),
        venueIds: ['lume-brera', 'corte-naviglio', 'sala-nove'],
        intent: {
          categories: [], requiredCategories: [], excludedCategories: [],
          neighborhoods: [], requiredNeighborhoods: [], excludedNeighborhoods: [],
          atmosphere: ['elegante'], requiredAtmosphere: [], requiredAtmosphereAny: [], excludedAtmosphere: [],
          occasions: ['aperitivo'], excludedOccasions: [], concepts: [], requiredConcepts: [], excludedConcepts: [],
          requiresOpenNow: false,
        },
      }));
    });
    await page.goto('/cerca/?q=aperitivo%20elegante', { waitUntil: 'domcontentloaded' });

    const profileSignal = page.locator('.profile-signal');
    const profileSummary = profileSignal.locator('summary');
    await expect(profileSummary).toContainText('Profilo di gusto attivo');
    await expect(profileSignal).not.toHaveAttribute('open', '');
    expect(await profileSummary.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

    await profileSummary.click();
    await expect(profileSignal).toHaveAttribute('open', '');
    await expect(profileSignal.locator('p')).toContainText('requisiti della ricerca');

    const offlineStatus = page.locator('.last-podium-status');
    const removeButton = offlineStatus.getByRole('button', { name: 'Cancella ultimo podio' });
    await expect(removeButton).toHaveText('Rimuovi');
    const buttonGeometry = await removeButton.evaluate((element) => {
      const buttonRect = element.getBoundingClientRect();
      const parentRect = element.parentElement?.getBoundingClientRect();
      return {
        inside: Boolean(parentRect && buttonRect.left >= parentRect.left && buttonRect.right <= parentRect.right),
        oneLine: getComputedStyle(element).whiteSpace === 'nowrap',
        targetHeight: buttonRect.height,
      };
    });
    expect(buttonGeometry.inside).toBe(true);
    expect(buttonGeometry.oneLine).toBe(true);
    expect(buttonGeometry.targetHeight).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  });

  test('il nome lungo della scheda locale va a capo senza uscire dalla card', async ({ page }) => {
    await page.route('**/api/venues/armani-bamboo-bar', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 'tre-catalog-v1',
        data: {
          id: '19186f27-30e0-4142-b839-7a05c029c6ed',
          slug: 'armani-bamboo-bar',
          name: 'Armani/Bamboo Bar',
          officialName: 'Armani/Bamboo Bar',
          description: 'Lounge bar al settimo piano dell’Armani Hotel Milano.',
          shortDescription: 'Cocktail e aperitivo panoramico.',
          category: { slug: 'rooftop', name: 'Rooftop' },
          subcategory: null,
          status: 'active',
          verification: {
            status: 'verified', maturity: 'gold', qualityScore: 88.64,
            completenessScore: 90, confidenceScore: 0.855,
            verifiedAt: '2026-07-17T09:26:02.891Z', staleAfter: '2026-09-15T09:26:02.891Z',
          },
          address: {
            formatted: 'Via Alessandro Manzoni 31, 20121 Milano', streetName: 'Via Alessandro Manzoni',
            streetNumber: '31', postalCode: '20121', locality: 'Milano', municipality: 1,
            neighborhood: { slug: 'quadrilatero-della-moda', name: 'Quadrilatero della moda' },
            latitude: 45.4704972, longitude: 9.1929464,
          },
          price: null, contacts: [], weeklyHours: [], hourExceptions: [], services: [], images: [], ratings: [], sources: [],
        },
      }),
    }));
    await page.goto('/locale/?slug=armani-bamboo-bar', { waitUntil: 'domcontentloaded' });
    const title = page.getByRole('heading', { level: 1, name: 'Armani/Bamboo Bar' });
    await expect(title).toBeVisible();
    const geometry = await title.evaluate((element) => {
      const titleRect = element.getBoundingClientRect();
      const parentRect = element.parentElement?.getBoundingClientRect();
      return {
        contained: Boolean(parentRect && titleRect.left >= parentRect.left - 1 && titleRect.right <= parentRect.right + 1),
        pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
        wraps: titleRect.height > Number.parseFloat(getComputedStyle(element).lineHeight) * 1.4,
      };
    });
    expect(geometry).toEqual({ contained: true, pageContained: true, wraps: true });
  });
});

test.describe('regressioni UI tablet dagli screenshot', () => {
  test.beforeEach(({ page }) => {
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width < 721 || width > 900, 'Contratto specifico tablet');
  });

  test('la testata della homepage contiene azioni e profilo senza overflow', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const geometry = await page.locator('.site-header__inner').evaluate((element) => {
      const headerRect = element.getBoundingClientRect();
      const actionsRect = element.querySelector('.site-header__actions')?.getBoundingClientRect();
      return {
        actionsInside: Boolean(actionsRect
          && actionsRect.left >= headerRect.left - 1
          && actionsRect.right <= headerRect.right + 1),
        pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      };
    });

    expect(geometry).toEqual({ actionsInside: true, pageContained: true });
  });
});
