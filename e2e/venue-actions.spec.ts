import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

test('la fixture espone solo Condividi e usa Clipboard quando Web Share non è disponibile', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { __venueCopiedUrl?: string }).__venueCopiedUrl = value;
        },
      },
    });
  });
  await page.goto('/locali/lume-brera/?tracking=non-condividere#dettaglio', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Lume Brera/);

  const layer = page.getByRole('region', { name: 'Organizza il prossimo passo' });
  await expect(layer).toHaveAttribute('data-client-ready', 'true');
  await expect(layer).toHaveAttribute('aria-busy', 'false');
  await expect(layer.getByRole('button', { name: 'Condividi' })).toBeEnabled();
  for (const label of ['Sito', 'Menu', 'Prenota', 'Chiama', 'Naviga']) {
    await expect(layer.getByRole('link', { name: new RegExp(label, 'i') })).toHaveCount(0);
  }

  await layer.getByRole('button', { name: 'Condividi' }).click();
  await expect(layer.getByRole('status')).toHaveText('Link copiato negli appunti.');
  const copiedUrl = await page.evaluate(() => (window as Window & { __venueCopiedUrl?: string }).__venueCopiedUrl);
  expect(copiedUrl).toBe(`${new URL(page.url()).origin}/locali/lume-brera/`);
  expect(runtimeErrors).toEqual([]);
});

test('se Web Share e Clipboard falliscono mantiene un link manualmente copiabile', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'share', { configurable: true, value: undefined });
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('blocked'); } },
    });
  });
  await page.goto('/locali/lume-brera/', { waitUntil: 'domcontentloaded' });
  const layer = page.getByRole('region', { name: 'Organizza il prossimo passo' });
  await expect(layer).toHaveAttribute('data-client-ready', 'true');
  await expect(layer.getByRole('button', { name: 'Condividi' })).toBeEnabled();
  await layer.getByRole('button', { name: 'Condividi' }).click();

  await expect(layer.getByRole('status')).toContainText('Copia automatica non disponibile');
  await expect(layer.getByLabel('Link da copiare')).toHaveValue(`${new URL(page.url()).origin}/locali/lume-brera/`);
  expect(runtimeErrors).toEqual([]);
});

test('il controllo SSR resta disabilitato finché l’isola React non è pronta', async ({ page }) => {
  let releaseAsset!: () => void;
  let markIntercepted!: () => void;
  const assetGate = new Promise<void>((resolve) => { releaseAsset = resolve; });
  const assetIntercepted = new Promise<void>((resolve) => { markIntercepted = resolve; });

  await page.route(/\/_astro\/VenueActionLayer\.[^/]+\.js$/, async (route) => {
    markIntercepted();
    await assetGate;
    await route.continue();
  });

  await page.goto('/locali/lume-brera/', { waitUntil: 'domcontentloaded' });
  await assetIntercepted;
  const layer = page.getByRole('region', { name: 'Organizza il prossimo passo' });
  const share = layer.getByRole('button', { name: 'Condividi' });

  await expect(layer).toHaveAttribute('data-client-ready', 'false');
  await expect(layer).toHaveAttribute('aria-busy', 'true');
  await expect(share).toBeDisabled();

  releaseAsset();
  await expect(layer).toHaveAttribute('data-client-ready', 'true');
  await expect(layer).toHaveAttribute('aria-busy', 'false');
  await expect(share).toBeEnabled();
});

test('l’action layer non introduce violazioni axe critical o serious', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await page.goto('/locali/lume-brera/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Organizza il prossimo passo' })).toBeVisible();

  const scan = await new AxeBuilder({ page })
    .include('[data-venue-action-layer]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = scan.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
  expect(blocking.map(({ id, impact, help, nodes }) => ({
    id,
    impact,
    help,
    targets: nodes.map(({ target }) => target.join(' ')),
  }))).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
