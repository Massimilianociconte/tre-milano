import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('la sidebar editoriale segue la sezione e mantiene CTA e correlati leggibili', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) <= 920, 'Contratto specifico desktop');
  await page.goto('/metodologia/', { waitUntil: 'domcontentloaded' });

  const aside = page.getByRole('complementary', { name: 'Indice e informazioni editoriali' });
  await expect(aside).toBeVisible();
  await expect(aside.locator('details')).toHaveAttribute('open', '');
  await expect(page.getByRole('navigation', { name: 'Indice della pagina' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Vincoli prima di tutto' })).toHaveAttribute('aria-current', 'true');

  await page.getByRole('link', { name: 'Spiegazioni verificabili' }).click();
  await expect(page).toHaveURL(/#spiegazioni$/);
  await expect(page.getByRole('link', { name: 'Spiegazioni verificabili' })).toHaveAttribute('aria-current', 'true');
  await expect(page.getByRole('link', { name: 'Apri fonti e dati' })).toHaveAttribute('href', '/fonti/');
  await expect(page.getByRole('complementary', { name: 'Approfondimenti correlati' })).toContainText('Continua a esplorare');
});

test('su mobile l’indice è compatto, apribile da tastiera e accessibile', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 9999) > 760, 'Contratto specifico mobile');
  await page.goto('/quartieri/brera/', { waitUntil: 'domcontentloaded' });

  const panel = page.locator('.editorial-aside__panel');
  await expect(panel).not.toHaveAttribute('open', '');
  const summary = panel.locator('summary');
  await summary.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toHaveAttribute('open', '');
  await expect(page.getByRole('navigation', { name: 'Indice della pagina' })).toBeVisible();

  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = scan.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious');
  expect(blocking.map(({ id, impact }) => ({ id, impact }))).toEqual([]);
});
