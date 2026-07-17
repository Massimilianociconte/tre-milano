import { expect, test, type Page } from '@playwright/test';
import { parseIntent } from '../src/ranking/rank';
import {
  SEARCH_INTERPRETATION_VERSION,
  interpretationFromLocalIntent,
} from '../src/search/interpretation-contract';

const endpointPattern = '**/api/search/interpret';

async function openSearch(page: Page, query: string) {
  await page.goto(`/cerca/?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Descrivi la serata che vuoi')).toHaveValue(query);
}

test('una richiesta semplice resta locale e non consuma una chiamata DeepSeek', async ({ page }) => {
  let remoteCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/search/interpret')) remoteCalls += 1;
  });

  await openSearch(page, 'aperitivo a Brera');
  await expect(page.locator('[data-interpretation-status="local"]')).toContainText('nessuna chiamata remota');
  expect(remoteCalls).toBe(0);
});

test('DeepSeek affina soltanto criteri strutturati e il ranker TRE ricalcola il podio', async ({ page }) => {
  const query = 'un posto che faccia colpo e sembri uscito da un film, senza essere ingessato';
  const local = interpretationFromLocalIntent(parseIntent(query));
  const intent = {
    ...local,
    atmosphere: ['elegante'] as const,
    occasions: ['aperitivo'] as const,
    semanticTokens: ['colpo', 'elegante', 'aperitivo'],
  };
  let requestBody: unknown;

  await page.route(endpointPattern, async (route) => {
    requestBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: SEARCH_INTERPRETATION_VERSION,
        source: 'deepseek',
        interpreter: { provider: 'deepseek', model: 'deepseek-v4-flash' },
        intent,
      }),
    });
  });

  await openSearch(page, query);
  await expect(page.locator('[data-interpretation-status="deepseek"]')).toContainText('Intento affinato');
  await expect(page.locator('.intent-summary')).toContainText('Elegante');
  await expect(page.locator('.intent-summary')).toContainText('Aperitivo');
  await expect(page.locator('.podium-list > .podium-card')).toHaveCount(3);
  expect(requestBody).toEqual({ version: SEARCH_INTERPRETATION_VERSION, query });
  expect(JSON.stringify(requestBody)).not.toMatch(/venue|profile|latitude|longitude|favorite/i);
});

test('timeout o errore remoto non svuota i risultati locali né rilassa i vincoli', async ({ page }) => {
  await page.route(endpointPattern, (route) => route.fulfill({ status: 503, body: '{}' }));
  const query = 'aperitivo elegante ma senza eccessi';

  await openSearch(page, query);
  await expect(page.locator('[data-interpretation-status="fallback"]')).toContainText('Risultati locali immediati');
  await expect(page.locator('.podium-list > .podium-card')).toHaveCount(3);
  await expect(page.locator('.intent-summary')).toContainText('Aperitivo');
});

test('una query con dato personale resta locale e non entra nella URL ordinaria', async ({ page }) => {
  let remoteCalls = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/search/interpret')) remoteCalls += 1;
  });
  await page.goto('/cerca/', { waitUntil: 'domcontentloaded' });
  const query = 'aperitivo per mario@example.it';
  await page.getByLabel('Descrivi la serata che vuoi').fill(query);
  await page.getByRole('button', { name: 'Trova la mia top 3' }).click();

  await expect(page.locator('[data-interpretation-status="privacy"]')).toContainText('Protezione dati attiva');
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  expect(remoteCalls).toBe(0);
});

test('una risposta tardiva della query precedente non sovrascrive quella più recente', async ({ page }) => {
  const firstQuery = 'vorrei un posto teatrale che faccia colpo come in un film';
  const secondQuery = 'vorrei staccare dal solito in un posto naturale e senza pose';
  let markFirstRequest: (() => void) | undefined;
  const firstRequestSeen = new Promise<void>((resolve) => { markFirstRequest = resolve; });

  const responseFor = (query: string, atmosphere: 'elegante' | 'rilassato') => ({
    version: SEARCH_INTERPRETATION_VERSION,
    source: 'deepseek',
    interpreter: { provider: 'deepseek', model: 'deepseek-v4-flash' },
    intent: {
      ...interpretationFromLocalIntent(parseIntent(query)),
      atmosphere: [atmosphere],
      semanticTokens: [atmosphere],
    },
  });

  await page.route(endpointPattern, async (route) => {
    const { query } = route.request().postDataJSON() as { query: string };
    if (query === firstQuery) {
      markFirstRequest?.();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    try {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(responseFor(query, query === firstQuery ? 'elegante' : 'rilassato')),
      });
    } catch {
      // Chromium può chiudere la prima route subito dopo l'AbortSignal: è il comportamento atteso.
    }
  });

  await page.goto('/cerca/', { waitUntil: 'domcontentloaded' });
  const search = page.getByLabel('Descrivi la serata che vuoi');
  await search.fill(firstQuery);
  await page.getByRole('button', { name: 'Trova la mia top 3' }).click();
  await firstRequestSeen;
  await search.fill(secondQuery);
  await page.getByRole('button', { name: 'Trova la mia top 3' }).click();

  await expect(page.locator('[data-interpretation-status="deepseek"]')).toContainText('Intento affinato');
  await expect(page.locator('.intent-summary')).toContainText('Rilassato');
  await page.waitForTimeout(650);
  await expect(page.locator('.intent-summary')).toContainText('Rilassato');
  await expect(page.locator('.intent-summary')).not.toContainText('Elegante');
});
