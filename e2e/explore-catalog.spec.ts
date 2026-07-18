import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const venues = [
  {
    id: '11111111-1111-4111-8111-111111111111', slug: 'notturno', name: 'Notturno',
    shortDescription: 'Cocktail d’autore in un ambiente intimo.',
    category: { slug: 'cocktail-bar', name: 'Cocktail bar' }, subcategorySlug: 'speakeasy',
    neighborhood: { slug: 'brera', name: 'Brera' }, municipality: 1,
    location: { latitude: 45.4722, longitude: 9.1886 }, formattedAddress: 'Via Brera 10, 20121 Milano',
    price: { level: 3, averageSpendCents: 3200, currency: 'EUR' }, ratings: [],
    primaryImage: {
      url: 'https://glalvaiuhrohrvauuwcp.supabase.co/storage/v1/object/public/venue-media/notturno.webp',
      alt: 'Bancone del locale Notturno',
    },
    services: ['reservations', 'vegan-options', 'wheelchair-access'],
    verification: { status: 'verified', maturity: 'gold', qualityScore: 91, confidenceScore: 0.91, verifiedAt: '2026-07-17T12:00:00Z' },
    openNow: true,
    distanceMeters: null,
    weeklyHours: [{ weekday: 6, sequence: 0, opensAt: '00:00', closesAt: '23:59', closesNextDay: false, closed: false }],
  },
  {
    id: '22222222-2222-4222-8222-222222222222', slug: 'cracco', name: 'Ristorante Cracco',
    shortDescription: 'Ristorante verificato in Galleria.',
    category: { slug: 'ristorante', name: 'Ristorante' }, subcategorySlug: null,
    neighborhood: { slug: 'duomo', name: 'Duomo' }, municipality: 1,
    location: { latitude: 45.4657, longitude: 9.1908 }, formattedAddress: 'Galleria Vittorio Emanuele II, 20121 Milano',
    price: { level: 4, averageSpendCents: 12000, currency: 'EUR' }, ratings: [], primaryImage: null,
    services: ['reservations'],
    verification: { status: 'verified', maturity: 'platinum', qualityScore: 96, confidenceScore: 0.96, verifiedAt: '2026-07-17T12:00:00Z' },
    openNow: false,
    distanceMeters: null, weeklyHours: [],
  },
  {
    id: '33333333-3333-4333-8333-333333333333', slug: 'pasticceria-esempio', name: 'Pasticceria Milano',
    shortDescription: null, category: { slug: 'pasticceria', name: 'Pasticceria' }, subcategorySlug: null,
    neighborhood: null, municipality: 3, location: { latitude: 45.4657, longitude: 9.1908 },
    formattedAddress: 'Via Esempio 8, 20100 Milano', price: { level: null, averageSpendCents: null, currency: 'EUR' },
    ratings: [], primaryImage: null, services: [],
    verification: { status: 'unverified', maturity: 'bronze', qualityScore: 10, confidenceScore: 0.3, verifiedAt: null },
    openNow: false,
    distanceMeters: null, weeklyHours: [],
  },
];

async function mockCatalog(page: Page) {
  await page.route('**/api/catalog**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/facets')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 'tre-catalog-v1',
          data: {
            total: 3,
            categories: [
              { slug: 'cocktail-bar', name: 'Cocktail bar', count: 1 },
              { slug: 'ristorante', name: 'Ristorante', count: 1 },
              { slug: 'pasticceria', name: 'Pasticceria', count: 1 },
            ],
            subcategories: [
              { slug: 'speakeasy', name: 'Speakeasy', categorySlug: 'cocktail-bar', count: 1 },
            ],
            neighborhoods: [
              { slug: 'brera', name: 'Brera', count: 1 },
              { slug: 'duomo', name: 'Duomo', count: 1 },
            ],
            services: [
              { slug: 'reservations', name: 'Prenotazione', count: 2 },
              { slug: 'vegan-options', name: 'Opzioni vegane', count: 1 },
              { slug: 'wheelchair-access', name: 'Accesso in sedia a rotelle', count: 1 },
            ],
            priceLevels: [{ level: 3, count: 1 }, { level: 4, count: 1 }],
          },
        }),
      });
      return;
    }
    const filtered = venues.filter((venue) => {
      const category = url.searchParams.get('category');
      const subcategory = url.searchParams.get('subcategory');
      const neighborhood = url.searchParams.get('neighborhood');
      const services = url.searchParams.getAll('service');
      const query = (url.searchParams.get('q') ?? '').toLocaleLowerCase('it-IT');
      const verifiedOnly = url.searchParams.get('include_unverified') === '0';
      const openNowOnly = url.searchParams.get('open_now') === '1';
      return (!category || venue.category.slug === category)
        && (!subcategory || venue.subcategorySlug === subcategory)
        && (!neighborhood || venue.neighborhood?.slug === neighborhood)
        && (!services.length || services.every((service) => (venue.services as string[]).includes(service)))
        && (!query || `${venue.name} ${venue.shortDescription ?? ''}`.toLocaleLowerCase('it-IT').includes(query))
        && (!verifiedOnly || venue.verification.status === 'verified')
        && (!openNowOnly || venue.openNow);
    });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 'tre-catalog-v1', data: filtered,
        pagination: { nextCursor: null, limit: 24, hasMore: false },
        meta: { sort: url.searchParams.get('sort') ?? 'quality', generatedAt: '2026-07-18T12:00:00Z' },
      }),
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockCatalog(page);
  await page.goto('/esplora/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.explore-card')).toHaveCount(3);
});

test('Scopri usa filtri reali, stato URL e una mappa sincronizzata', async ({ page }) => {
  await expect(page.locator('.explore__summary')).toContainText('3 locali nel catalogo');
  await page.getByLabel('Categoria', { exact: true }).selectOption('cocktail-bar');
  await expect(page.locator('.explore-card')).toHaveCount(1);
  await expect(page.locator('.explore-card h3')).toHaveText('Notturno');
  await expect.poll(() => new URL(page.url()).searchParams.get('category')).toBe('cocktail-bar');
  await page.getByLabel('Sottocategoria', { exact: true }).selectOption('speakeasy');
  await expect.poll(() => new URL(page.url()).searchParams.get('subcategory')).toBe('speakeasy');

  await page.getByRole('button', { name: 'Mappa' }).click();
  const marker = page.getByRole('button', { name: /Seleziona Notturno/ });
  await expect(marker).toBeVisible();
  await marker.click();
  await expect(marker).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.explore-map__preview')).toContainText('Notturno');
  await expect(page.locator('.explore-card')).toHaveClass(/is-selected/);
});

test('ricerca nomi reali e separa atmosfera, occasione, accessibilità e dieta', async ({ page }) => {
  const requests: URL[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/catalog') requests.push(url);
  });

  const input = page.getByLabel('Nome o parola chiave');
  await input.fill('Ristorante Cracco');
  await page.getByRole('button', { name: 'Cerca nel catalogo' }).click();
  await expect(page.locator('.explore-card h3')).toHaveText('Ristorante Cracco');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(requests.some((url) => url.searchParams.get('q') === 'Ristorante Cracco')).toBe(true);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);

  await page.getByLabel('Atmosfera').selectOption('intimo');
  await expect.poll(() => new URL(page.url()).searchParams.get('atmosphere')).toBe('intimo');
  await page.getByLabel('Occasione').selectOption('aperitivo');
  await expect.poll(() => requests.some((url) => url.searchParams.get('q')?.includes('intimo aperitivo'))).toBe(true);

  await page.getByLabel('Accessibilità').selectOption('wheelchair-access');
  await page.getByLabel('Opzioni alimentari').selectOption('vegan-options');
  await expect.poll(() => requests.some((url) => {
    const services = url.searchParams.getAll('service');
    return services.includes('wheelchair-access') && services.includes('vegan-options');
  })).toBe(true);

  await expect(page.getByLabel('Ordina locali')).toContainText('Valutazione e popolarità');
});

test('la composizione è contenuta, leggibile e accessibile a ogni breakpoint', async ({ page }) => {
  await page.evaluate(async () => { await document.fonts.ready; });
  const geometry = await page.evaluate(() => {
    const form = document.querySelector('.explore__filters')?.getBoundingClientRect();
    return {
      pageContained: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      formVisible: Boolean(form && form.top >= 0 && form.width <= document.documentElement.clientWidth),
    };
  });
  expect(geometry).toEqual({ pageContained: true, formVisible: true });

  const verified = page.locator('.explore-card--verified').first();
  await expect(verified.locator('figcaption')).toHaveText('Immagine approvata del locale');
  await expect(verified.locator('img')).toHaveAttribute('src', /^\/\.netlify\/images\?/);
  await expect(verified.locator('.explore-card__cta')).toContainText('Apri il venue passport');

  const violations = await new AxeBuilder({ page })
    .disableRules(['color-contrast'])
    .analyze();
  expect(violations.violations).toEqual([]);
});

test('Aperti ora interroga il catalogo globale prima della paginazione', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Aperti ora' }).check();
  await expect(page.locator('.explore-card')).toHaveCount(1);
  await expect(page.locator('.explore-card h3')).toHaveText('Notturno');
  await expect(page.locator('.explore__summary')).toHaveText('1 locale trovato');
  await expect.poll(() => new URL(page.url()).searchParams.get('open')).toBe('1');
});

test('la ricerca libera resta fuori dalla cronologia e blocca dati personali', async ({ page }) => {
  const catalogQueries: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/catalog') catalogQueries.push(url.searchParams.get('q') ?? '');
  });

  const input = page.getByLabel('Nome o parola chiave');
  await input.fill('terrazza jazz');
  await page.getByRole('button', { name: 'Cerca nel catalogo' }).click();
  await expect.poll(() => catalogQueries.includes('terrazza jazz')).toBe(true);
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);

  await input.fill('mario.rossi@example.com');
  await page.getByRole('button', { name: 'Cerca nel catalogo' }).click();
  await expect(page.getByRole('alert')).toContainText('proteggere la tua privacy');
  expect(catalogQueries).not.toContain('mario.rossi@example.com');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
});

test('Vicino a me inoltra solo coordinate urbane approssimate', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 45.4642714, longitude: 9.1895107 });
  let geoLatitude: string | null = null;
  let geoLongitude: string | null = null;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/catalog' && url.searchParams.has('lat')) {
      geoLatitude = url.searchParams.get('lat');
      geoLongitude = url.searchParams.get('lng');
    }
  });

  await page.getByRole('button', { name: 'Vicino a me' }).click();
  await expect.poll(() => geoLatitude).toBe('45.464');
  expect(geoLongitude).toBe('9.19');
});

test('la mappa raggruppa e separa marker sovrapposti senza perdere accessibilità', async ({ page }) => {
  await page.getByRole('button', { name: 'Mappa' }).click();
  const cluster = page.getByRole('button', { name: 'Espandi 2 locali in questa zona' });
  await expect(cluster).toBeVisible();
  await cluster.click();
  await expect(page.getByRole('button', { name: /Seleziona Ristorante Cracco/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Seleziona Pasticceria Milano/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Raggruppa 2 locali in questa zona' })).toHaveAttribute('aria-expanded', 'true');
});
