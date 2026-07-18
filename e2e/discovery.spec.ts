import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const SEARCH_QUERY = 'aperitivo elegante';

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function openSearch(page: Page, query = SEARCH_QUERY) {
  await page.goto(`/cerca/?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/TRE Milano/);
  await expect(page.getByRole('heading', { level: 2, name: 'Top 3 per te' })).toBeVisible();
  await expect(page.getByLabel('Descrivi la serata che vuoi')).toHaveValue(query);
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function expectAllVisible(locator: Locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    await expect(locator.nth(index)).toBeVisible();
  }
}

async function podiumNamesByRank(page: Page) {
  return page.locator('.podium-card').evaluateAll((cards) => Object.fromEntries(
    cards.map((card) => [
      card.getAttribute('data-rank') ?? '',
      card.querySelector('h3')?.textContent?.trim() ?? '',
    ]),
  ));
}

test('il podio mantiene DOM semantico 1–2–3 e composizione visuale 2–1–3', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openSearch(page);

  const cards = page.locator('.podium-list > .podium-card');
  await expect(cards).toHaveCount(3);
  await expectAllVisible(cards);

  const crownFrames = cards.locator('.podium-card__frame');
  await expect(crownFrames).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    await expect(crownFrames.nth(index)).toHaveAttribute('data-crown-lobes', '3');
  }

  const crownGeometry = await cards.evaluateAll((items) => items.map((item) => ({
    cap: item.querySelector('.podium-card__crown-cap')?.getAttribute('d') ?? '',
    outline: item.querySelector('.podium-card__outline')?.getAttribute('d') ?? '',
  })));
  expect(crownGeometry.every(({ cap, outline }) => (
    cap.startsWith('M ')
    && outline.startsWith('M ')
    && (cap.match(/\bC\b/g)?.length ?? 0) >= 3
    && (outline.match(/\bC\b/g)?.length ?? 0) >= 6
  ))).toBe(true);

  const crownStyles = await cards.evaluateAll((items) => items.map((item) => {
    const frame = item.querySelector<HTMLElement>('.podium-card__frame');
    const visual = item.querySelector<HTMLElement>('.podium-card__visual');
    const outline = item.querySelector<SVGElement>('.podium-card__outline');
    const rank = item.querySelector<HTMLElement>('.podium-card__rank');
    if (!frame || !visual || !outline || !rank) return null;
    const visualRect = visual.getBoundingClientRect();
    const rankRect = rank.getBoundingClientRect();
    return {
      frameClipPath: getComputedStyle(frame).clipPath,
      visualClipPath: getComputedStyle(visual).clipPath,
      outlineStroke: getComputedStyle(outline).stroke,
      rankInsideCrown: rankRect.top >= visualRect.top && rankRect.bottom < visualRect.top + (visualRect.height * 0.3),
      crownIsShallow: visualRect.height < frame.getBoundingClientRect().height * 0.55,
    };
  }));
  expect(crownStyles.every((style) => (
    style
    && style.frameClipPath === 'none'
    && style.visualClipPath.startsWith('url(')
    && style.outlineStroke !== 'none'
    && style.rankInsideCrown
    && style.crownIsShallow
  ))).toBe(true);

  const cardAnatomy = await cards.evaluateAll((items) => items.map((item) => {
    const rank = item.getAttribute('data-rank');
    const title = item.querySelector<HTMLElement>('h3');
    const facts = item.querySelector<HTMLElement>('.podium-card__facts');
    const action = item.querySelector<HTMLElement>('.podium-card__open');
    if (!title || !facts || !action) return null;
    const titleStyle = getComputedStyle(title);
    const actionStyle = getComputedStyle(action);
    return {
      rank,
      factCount: facts.children.length,
      titleAlign: titleStyle.textAlign,
      titleTransform: titleStyle.textTransform,
      titleFamily: titleStyle.fontFamily,
      actionRadius: Number.parseFloat(actionStyle.borderRadius),
      actionBackground: actionStyle.backgroundColor,
    };
  }));
  expect(cardAnatomy.every((card) => (
    card
    && card.factCount === (card.rank === '1' ? 4 : 3)
    && card.titleAlign === 'left'
    && card.titleTransform === 'uppercase'
    && /inter|sans/i.test(card.titleFamily)
    && card.actionRadius <= 8
    && card.actionBackground === 'rgb(8, 19, 33)'
  ))).toBe(true);

  const domRanks = await cards.evaluateAll((items) => items.map((item) => item.getAttribute('data-rank')));
  expect(domRanks).toEqual(['1', '2', '3']);

  const visualRanks = await cards.evaluateAll((items) => items
    .map((item) => ({
      rank: item.getAttribute('data-rank'),
      left: item.getBoundingClientRect().left,
    }))
    .sort((left, right) => left.left - right.left)
    .map(({ rank }) => rank));
  expect(visualRanks).toEqual((page.viewportSize()?.width ?? 999) <= 760 ? ['1', '2', '3'] : ['2', '1', '3']);

  const geometry = await cards.evaluateAll((items) => items.map((item) => {
    const card = item.getBoundingClientRect();
    const name = item.querySelector('h3')?.getBoundingClientRect();
    const cta = item.querySelector<HTMLElement>('.podium-card__open')?.getBoundingClientRect();
    return {
      rank: item.getAttribute('data-rank'),
      card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
      nameInside: Boolean(name && name.left >= card.left && name.right <= card.right),
      ctaInside: Boolean(cta && cta.left >= card.left && cta.right <= card.right),
    };
  }));
  expect(geometry.every(({ nameInside, ctaInside }) => nameInside && ctaInside)).toBe(true);
  if ((page.viewportSize()?.width ?? 999) <= 760) {
    const rankOne = geometry.find(({ rank }) => rank === '1')!;
    const rankTwo = geometry.find(({ rank }) => rank === '2')!;
    const rankThree = geometry.find(({ rank }) => rank === '3')!;
    expect(rankOne.card.right - rankOne.card.left).toBeGreaterThan(rankTwo.card.right - rankTwo.card.left);
    expect(rankTwo.card.right).toBeLessThanOrEqual(rankThree.card.left);
    expect(rankTwo.card.top).toBeGreaterThanOrEqual(rankOne.card.bottom);
  }

  const rankOneMediaHeight = await page.locator('.podium-card[data-rank="1"] .podium-card__media')
    .evaluate((element) => element.getBoundingClientRect().height);
  const rankTwoMediaHeight = await page.locator('.podium-card[data-rank="2"] .podium-card__media')
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(rankOneMediaHeight).toBeGreaterThan(rankTwoMediaHeight);
  expect(runtimeErrors).toEqual([]);
});

test('mappa e podio restano sincronizzati anche da tastiera', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openSearch(page);

  const markers = page.locator('.map-marker');
  await expect(markers).toHaveCount(3);
  await expect(page.locator('.milano-map__preview')).toHaveAttribute(
    'data-active-venue',
    await page.locator('.podium-card[data-rank="1"]').getAttribute('data-venue-id') ?? '',
  );

  const rankTwoCard = page.locator('.podium-card[data-rank="2"]');
  const rankTwoId = await rankTwoCard.getAttribute('data-venue-id');
  await page.getByRole('button', { name: /Posizione 2: seleziona/ }).click();
  await expect(rankTwoCard).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('.milano-map__preview')).toHaveAttribute('data-active-venue', rankTwoId ?? '');

  const rankThreeCard = page.locator('.podium-card[data-rank="3"]');
  const rankThreeId = await rankThreeCard.getAttribute('data-venue-id');
  const rankThreeMarker = page.getByRole('button', { name: /Posizione 3: seleziona/ });
  await rankThreeMarker.focus();
  await page.keyboard.press('Enter');
  await expect(rankThreeMarker).toHaveAttribute('aria-pressed', 'true');
  await expect(rankThreeCard).toHaveAttribute('aria-current', 'location');
  await expect(page.locator('.milano-map__preview')).toHaveAttribute('data-active-venue', rankThreeId ?? '');
  await expect(page.locator('.milano-map__preview a')).toHaveAttribute('href', /\/locali\/.+\/$/);
  await expect(page.locator('.milano-map__cta')).toHaveAttribute('href', '/milano/');
  expect(runtimeErrors).toEqual([]);
});

test('la ricerca dalla homepage conserva la query e rende risultati reali', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: /Il meglio di Milano/ })).toBeVisible();

  const search = page.getByLabel('Descrivi la serata che vuoi');
  await search.fill(SEARCH_QUERY);
  await page.getByRole('button', { name: 'Trova la mia top 3' }).click();

  await expect(page).toHaveURL((url) => (
    url.pathname === '/cerca/'
    && !url.searchParams.has('q')
  ));
  await expect(page.getByLabel('Descrivi la serata che vuoi')).toHaveValue(SEARCH_QUERY);
  await expect(page.locator('.podium-list > .podium-card')).toHaveCount(3);
  await expect(page.locator('.context-card small')).toHaveText(SEARCH_QUERY);
  expect(await page.evaluate(() => sessionStorage.getItem('tre-milano:search-handoff:v1'))).toBeNull();
  expect(runtimeErrors).toEqual([]);
});

test('un vincolo safety-critical produce uno stato vuoto esplicito e sicuro', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openSearch(page, 'aperitivo senza glutine');

  await expect(page.locator('.podium-list > .podium-card')).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3, name: 'Serve un dato verificato in più' })).toBeVisible();
  await expect(page.locator('.podium-empty')).toContainText('Non proponiamo locali per requisiti alimentari o allergeni');
  await expect(page.locator('main')).not.toContainText(/\b(?:undefined|NaN)\b/);
  expect(runtimeErrors).toEqual([]);
});

test('ricalcola una sola posizione senza mutare le altre due', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openSearch(page);

  const before = await podiumNamesByRank(page);
  const rankTwo = page.locator('.podium-card[data-rank="2"]');
  await rankTwo.locator('summary').click();
  await rankTwo.getByRole('button', { name: 'Ricalcola senza' }).click();

  await expect.poll(async () => (await podiumNamesByRank(page))['2']).not.toBe(before['2']);
  const after = await podiumNamesByRank(page);
  expect(after['1']).toBe(before['1']);
  expect(after['2']).not.toBe(before['2']);
  expect(after['3']).toBe(before['3']);
  await expect(page.locator('.discovery > .sr-only[aria-live="polite"]'))
    .toContainText('le altre due scelte sono rimaste invariate');
  expect(runtimeErrors).toEqual([]);
});

test('i dettagli del podio sono apribili da tastiera e Escape ripristina il focus', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openSearch(page);

  const details = page.locator('.podium-card[data-rank="1"] details');
  const summary = details.locator('summary');
  await summary.focus();
  await expect(summary).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(details).toHaveAttribute('open', '');
  const explanationSheet = details.locator(':scope > div');
  await expect(explanationSheet).toBeVisible();
  const explanationBox = await explanationSheet.boundingBox();
  const viewport = page.viewportSize();
  expect(explanationBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(explanationBox!.y).toBeGreaterThanOrEqual(0);
  expect(explanationBox!.y + explanationBox!.height).toBeLessThanOrEqual(viewport!.height);
  await page.keyboard.press('Escape');
  await expect(details).not.toHaveAttribute('open', '');
  await expect(summary).toBeFocused();
  expect(runtimeErrors).toEqual([]);
});

test('axe non rileva violazioni critical o serious nella homepage interattiva', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.podium-list > .podium-card')).toHaveCount(3);

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = scan.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
  const report = blocking.map(({ id, impact, help, nodes }) => ({
    id,
    impact,
    help,
    targets: nodes.map(({ target }) => target.join(' ')),
  }));

  expect(report, JSON.stringify(report, null, 2)).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('la posizione viene richiesta solo al click, resta di sessione e può tornare al Duomo', async ({ context, page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openSearch(page, 'entro 45 minuti a piedi');
  const origin = new URL(page.url()).origin;
  await context.grantPermissions(['geolocation'], { origin });
  await context.setGeolocation({ latitude: 45.476, longitude: 9.205 });

  const control = page.locator('.travel-origin-control');
  await expect(control).toContainText('Origine Duomo');
  await expect(control).toContainText('Attivazione solo su richiesta');
  await control.getByRole('button', { name: 'Usa la mia posizione' }).click();

  await expect(control).toContainText('La tua posizione · solo questa sessione');
  await expect(control).toContainText('Tempi a piedi stimati, non routing');
  await expect(page.locator('.podium-card__session-travel').first()).toContainText('stimata, non routing');
  expect(new URL(page.url()).searchParams.has('lat')).toBe(false);
  const storageSnapshot = await page.evaluate(() => JSON.stringify(localStorage));
  expect(storageSnapshot).not.toContain('45.476');
  expect(storageSnapshot).not.toContain('9.205');

  await control.getByRole('button', { name: 'Ripristina Duomo' }).click();
  await expect(control).toContainText('Origine Duomo');
  await expect(page.locator('.podium-card__session-travel')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('un permesso posizione negato mantiene il Duomo e mostra un errore recuperabile', async ({ context, page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await context.clearPermissions();
  await openSearch(page);

  const control = page.locator('.travel-origin-control');
  await control.getByRole('button', { name: 'Usa la mia posizione' }).click();
  await expect(control).toContainText('Permesso negato');
  await expect(control).toContainText('Origine Duomo');
  await expect(control.getByRole('button', { name: 'Riprova' })).toBeEnabled();
  await expect(page.locator('.podium-card__session-travel')).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
});

test('salva un podio minimizzato, lo ripristina offline e permette di cancellarlo', async ({ context, page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const query = 'aperitivo elegante frase segreta omega';
  await openSearch(page, query);

  const offlineStatus = page.locator('.last-podium-status');
  await expect(offlineStatus).toContainText('Ultimo podio disponibile offline');
  const before = await podiumNamesByRank(page);
  const stored = await page.evaluate(() => localStorage.getItem('tre-milano:last-podium:v1'));
  expect(stored).not.toBeNull();
  expect(stored).not.toContain('frase segreta');
  expect(stored).not.toContain('omega');
  expect(stored).not.toMatch(/"(?:query|semanticTokens|profile|coordinates|latitude|longitude|label)"/);
  const parsed = JSON.parse(stored!);
  expect(Object.keys(parsed).sort()).toEqual(['createdAt', 'expiresAt', 'intent', 'venueIds', 'version']);
  expect(parsed.venueIds).toHaveLength(3);

  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
        void registration.update();
      });
    }
    history.replaceState({}, '', '/cerca/');
  });

  await context.setOffline(true);
  const cachedShell = await page.evaluate(async () => {
    const response = await fetch('/cerca/');
    return { ok: response.ok, body: await response.text() };
  });
  expect(cachedShell.ok).toBe(true);
  expect(cachedShell.body).toContain('Dimmi che serata vuoi.');
  await context.setOffline(false);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'onLine', {
      configurable: true,
      get: () => false,
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offlineRuntime = await page.evaluate(() => ({
    online: navigator.onLine,
    stored: localStorage.getItem('tre-milano:last-podium:v1'),
  }));
  expect(offlineRuntime.online).toBe(false);
  expect(offlineRuntime.stored).not.toBeNull();
  await expect(page.locator('.last-podium-status.is-restored')).toContainText('Ultimo podio ripristinato offline');
  await expect(page.getByLabel('Descrivi la serata che vuoi')).toHaveValue('');
  await expect.poll(async () => await podiumNamesByRank(page)).toEqual(before);

  await page.getByRole('button', { name: 'Cancella ultimo podio' }).click();
  await expect(page.locator('.last-podium-status')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('tre-milano:last-podium:v1'))).toBeNull();
  expect(runtimeErrors).toEqual([]);
});
