import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sources = [
  'scripts/generate-service-worker.mjs',
  'public/sw.js',
];

describe('service worker privacy-safe search shell', () => {
  for (const relativePath of sources) {
    it(`${relativePath} conserva la ricerca offline senza salvare la query`, async () => {
      const source = await readFile(resolve(process.cwd(), relativePath), 'utf8');
      const branch = source.match(/if \(isSearchShellNavigation\) \{([\s\S]*?)\n  \}/)?.[1] || '';

      expect(source).toContain("'/cerca/'");
      expect(source).toContain("const NETWORK_ONLY_PATHS = ['/api/']");
      expect(branch).toContain('fetch(event.request).catch');
      expect(branch).toContain("caches.match('/cerca/', { ignoreSearch: true })");
      expect(branch).not.toContain('cache.put');
      expect(branch).not.toContain('caches.open');
      expect(source.indexOf('if (isSearchShellNavigation)')).toBeLessThan(source.indexOf('if (url.search)'));
    });
  }
});
