import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';
import path from 'node:path';
import { loadResponsiveConfig, projectRoot, versionDirectory } from './responsive-images-lib.mjs';
import { hasAltAttribute } from './html-audit-lib.mjs';

const execFileAsync = promisify(execFile);

test('manifest responsive valido e generazione idempotente', async () => {
  const config = await loadResponsiveConfig();
  const manifestPath = path.join(versionDirectory(config), 'manifest.json');
  const contentBefore = await readFile(manifestPath, 'utf8');
  const modifiedBefore = (await stat(manifestPath)).mtimeMs;

  const generated = await execFileAsync(process.execPath, ['scripts/generate-responsive-images.mjs'], { cwd: projectRoot });
  assert.match(generated.stdout, /già aggiornati/);
  assert.equal(await readFile(manifestPath, 'utf8'), contentBefore);
  assert.equal((await stat(manifestPath)).mtimeMs, modifiedBefore);

  const audited = await execFileAsync(process.execPath, ['scripts/audit-responsive-images.mjs'], { cwd: projectRoot });
  assert.match(audited.stdout, /nessun upscale/);
});

test('audit HTML accetta alt descrittivo e alt vuoto serializzato da Astro', () => {
  assert.equal(hasAltAttribute('<img src="hero.avif" alt="Milano al tramonto" width="1600" height="900">'), true);
  assert.equal(hasAltAttribute('<img src="hero.avif" alt width="1600" height="900" role="presentation">'), true);
  assert.equal(hasAltAttribute('<img src="hero.avif" width="1600" height="900">'), false);
});
