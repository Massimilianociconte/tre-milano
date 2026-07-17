import { describe, expect, it } from 'vitest';
import { CatalogQueryError, decodeCatalogCursor, encodeCatalogCursor, parseCatalogQuery } from './catalog-query';

const ID = 'f3da8434-e4fe-4ce9-8a6f-323f90a43ac5';

describe('catalog query contract', () => {
  it('parses combinable geo, taxonomy and pagination filters', () => {
    const cursor = encodeCatalogCursor({ value: 412.5, id: ID });
    const parsed = parseCatalogQuery(new URL(`https://tre.test/api/catalog?q=aperitivo&category=rooftop,cocktail-bar&service=terrazza&lat=45.46&lng=9.19&radius_m=2000&sort=distance&limit=12&cursor=${cursor}`));
    expect(parsed).toMatchObject({
      query: 'aperitivo', categorySlugs: ['rooftop', 'cocktail-bar'], serviceSlugs: ['terrazza'],
      latitude: 45.46, longitude: 9.19, radiusMeters: 2000, sort: 'distance', limit: 12,
      cursor: { value: 412.5, id: ID },
    });
  });

  it('round-trips an opaque cursor', () => {
    expect(decodeCatalogCursor(encodeCatalogCursor({ value: 0.812, id: ID }))).toEqual({ value: 0.812, id: ID });
  });

  it.each([
    'limit=51', 'price_min=4&price_max=2', 'lat=45.4', 'lat=95&lng=9',
    'radius_m=99&lat=45.4&lng=9.1', 'bbox=9.2,45.5,9.1,45.4', 'sort=popular', 'category=Rooftop!',
  ])('rejects invalid input: %s', (query) => {
    expect(() => parseCatalogQuery(new URL(`https://tre.test/api/catalog?${query}`))).toThrow(CatalogQueryError);
  });
});
