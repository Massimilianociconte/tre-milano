import { describe, expect, it } from 'vitest';
import { getRouteIndexPolicy, INDEXABLE_ROUTES, isRouteIndexable, normalizeRoutePath } from './indexing';

describe('quality gate di indicizzazione', () => {
  it('normalizza i percorsi canonici con trailing slash', () => {
    expect(normalizeRoutePath('/metodologia')).toBe('/metodologia/');
    expect(normalizeRoutePath('/')).toBe('/');
  });

  it('distingue URL ready da contenuti ancora draft', () => {
    expect(getRouteIndexPolicy('/metodologia/')?.status).toBe('ready');
    expect(getRouteIndexPolicy('/milano/')?.status).toBe('draft');
    expect(INDEXABLE_ROUTES.every((route) => /^\d{4}-\d{2}-\d{2}$/.test(route.lastmod))).toBe(true);
  });

  it('mantiene ogni URL noindex quando il sito è in preview', () => {
    expect(isRouteIndexable('/metodologia/')).toBe(false);
    expect(isRouteIndexable('/locali/lume-brera/')).toBe(false);
  });
});
