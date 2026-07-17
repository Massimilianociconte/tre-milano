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

async function openGroupSession(page: Page) {
  await page.goto('/gruppo/', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveTitle(/Scegliere insieme/);
  await expect(page.getByRole('heading', { level: 1, name: /Decidete insieme/ })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
}

test('crea, condivide e reimporta una sessione anonima senza storage', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openGroupSession(page);

  const participants = page.getByRole('article');
  await expect(participants).toHaveCount(2);
  await participants.nth(0).getByRole('button', { name: 'Aperitivo', exact: true }).click();
  await participants.nth(0).getByRole('button', { name: 'Vista panoramica', exact: true }).click();
  await participants.nth(0).getByLabel('Prima scelta').selectOption('panoramico');
  await participants.nth(0).getByLabel('Budget massimo').selectOption('3');
  await participants.nth(0).getByRole('button', { name: 'Duomo', exact: true }).click();

  await participants.nth(1).getByRole('button', { name: 'Aperitivo', exact: true }).click();
  await participants.nth(1).getByLabel('Budget massimo').selectOption('2');
  await participants.nth(1).getByRole('button', { name: 'Duomo', exact: true }).click();

  const summary = page.getByLabel('Sintesi della sessione');
  await expect(summary.getByText('Fino a €€', { exact: true })).toBeVisible();
  await expect(summary.getByText('Aperitivo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Genera link' }).click();

  const generatedLink = await page.getByLabel('Link della sessione').inputValue();
  const url = new URL(generatedLink);
  expect(url.pathname).toBe('/gruppo/');
  expect(url.search).toBe('');
  expect(url.hash).toMatch(/^#g=[A-Za-z0-9_-]+$/);
  expect(url.hash).not.toContain('aperitivo');

  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Sintesi della sessione').getByRole('status')).toContainText('Sessione importata dal link');
  await expect(page.getByRole('article').nth(0).getByRole('button', { name: 'Vista panoramica', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('article').nth(1).getByLabel('Budget massimo')).toHaveValue('2');
  expect(runtimeErrors).toEqual([]);
});

test('non accetta input SSR prima dell’idratazione e conserva il conflitto nel link', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const componentAsset = /\/_astro\/GroupSessionPlanner\..+\.js$/;

  await page.route(componentAsset, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    await route.continue();
  });

  await page.goto('/gruppo/', { waitUntil: 'domcontentloaded' });

  const island = page.locator('astro-island[component-url*="GroupSessionPlanner"]');
  const workspace = page.locator('[data-group-workspace]');
  await expect(island).toHaveAttribute('ssr', '');
  await expect(workspace).toHaveAttribute('inert', '');
  await expect(workspace).toHaveAttribute('aria-busy', 'true');

  await expect(island).not.toHaveAttribute('ssr', '');
  await expect(workspace).not.toHaveAttribute('inert', '');
  await expect(workspace).toHaveAttribute('aria-busy', 'false');
  await page.unroute(componentAsset);

  const participants = page.getByRole('article');
  await participants.nth(0).getByRole('button', { name: 'Brera', exact: true }).click();
  await participants.nth(1).getByRole('button', { name: 'Navigli', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Le zone non coincidono');

  await page.getByRole('button', { name: 'Genera link' }).click();
  const generatedHash = new URL(page.url()).hash;
  expect(generatedHash).toMatch(/^#g=[A-Za-z0-9_-]+$/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByLabel('Sintesi della sessione').getByRole('status')).toContainText('Sessione importata dal link');
  await expect(page.getByRole('alert')).toContainText('Le zone non coincidono');
  expect(new URL(page.url()).hash).toBe(generatedHash);
  expect(runtimeErrors).toEqual([]);
});

test('gestisce da due a sei persone e rende esplicito un conflitto hard', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openGroupSession(page);

  const participants = page.getByRole('article');
  await participants.nth(0).getByRole('button', { name: 'Brera', exact: true }).click();
  await participants.nth(1).getByRole('button', { name: 'Navigli', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Le zone non coincidono');

  await participants.nth(1).getByRole('button', { name: 'Brera', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Brera', { exact: true }).last()).toBeVisible();

  for (let count = 2; count < 6; count += 1) {
    await page.getByRole('button', { name: 'Aggiungi una persona anonima' }).click();
  }
  await expect(participants).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Limite di sei persone raggiunto' })).toBeDisabled();
  await participants.nth(5).getByRole('button', { name: 'Rimuovi Persona 6' }).click();
  await expect(participants).toHaveCount(5);
  expect(runtimeErrors).toEqual([]);
});

test('non presenta violazioni axe critical o serious nel flusso gruppo', async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await openGroupSession(page);

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = scan.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
  expect(blocking.map(({ id, impact, help }) => ({ id, impact, help }))).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});
