import { describe, expect, it } from 'vitest';
import { CatalogQueryError, decodeCatalogCursor, encodeCatalogCursor, parseCatalogQuery } from './catalog-query';

const ID = 'f3da8434-e4fe-4ce9-8a6f-323f90a43ac5';

describe('catalog query contract', () => {
  it('parses combinable geo, taxonomy and pagination filters', () => {
    const cursor = encodeCatalogCursor({ value: 412.5, id: ID });
    const parsed = parseCatalogQuery(new URL(`https://tre.test/api/catalog?q=aperitivo&category=rooftop,cocktail-bar&subcategory=speakeasy&service=terrazza&lat=45.46&lng=9.19&radius_m=2000&open_now=1&sort=distance&limit=12&cursor=${cursor}`));
    expect(parsed).toMatchObject({
      query: 'aperitivo', categorySlugs: ['rooftop', 'cocktail-bar'], subcategorySlugs: ['speakeasy'], serviceSlugs: ['terrazza'],
      latitude: 45.46, longitude: 9.19, radiusMeters: 2000, openNow: true, sort: 'distance', limit: 12,
      cursor: { value: 412.5, id: ID },
    });
  });

  it('round-trips an opaque cursor', () => {
    expect(decodeCatalogCursor(encodeCatalogCursor({ value: 0.812, id: ID }))).toEqual({ value: 0.812, id: ID });
    expect(decodeCatalogCursor(encodeCatalogCursor({ value: 'armani/bamboo bar', id: ID }))).toEqual({
      value: 'armani/bamboo bar', id: ID,
    });
  });

  it('round-trips cursori UTF-8 e applica il limite in byte in modo simmetrico', () => {
    const unicode = 'Crêperie Navigli — caffè ☕';
    expect(decodeCatalogCursor(encodeCatalogCursor({ value: unicode, id: ID }))).toEqual({ value: unicode, id: ID });

    const exactAscii = 'a'.repeat(240);
    const exactUtf8 = 'é'.repeat(120);
    expect(decodeCatalogCursor(encodeCatalogCursor({ value: exactAscii, id: ID }))?.value).toBe(exactAscii);
    expect(decodeCatalogCursor(encodeCatalogCursor({ value: exactUtf8, id: ID }))?.value).toBe(exactUtf8);
    expect(() => encodeCatalogCursor({ value: 'a'.repeat(241), id: ID })).toThrow(CatalogQueryError);
    expect(() => encodeCatalogCursor({ value: 'é'.repeat(121), id: ID })).toThrow(CatalogQueryError);

    const oversizedDecodedValue = btoa(JSON.stringify({ v: 'a'.repeat(241), i: ID }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(() => decodeCatalogCursor(oversizedDecodedValue)).toThrow(CatalogQueryError);
    expect(() => decodeCatalogCursor('a'.repeat(513))).toThrow(CatalogQueryError);
    expect(() => decodeCatalogCursor('_w')).toThrow(CatalogQueryError);
  });

  it('supporta gli ordinamenti server-side alfabetico e novità con cursor tipizzati', () => {
    const nameCursor = encodeCatalogCursor({ value: 'armani/bamboo bar', id: ID, sort: 'name' });
    const newestCursor = encodeCatalogCursor({ value: 1_774_000_000, id: ID, sort: 'newest' });
    expect(parseCatalogQuery(new URL(`https://tre.test/api/catalog?sort=name&cursor=${nameCursor}`))).toMatchObject({
      sort: 'name', cursor: { value: 'armani/bamboo bar', id: ID, sort: 'name' },
    });
    expect(parseCatalogQuery(new URL(`https://tre.test/api/catalog?sort=newest&cursor=${newestCursor}`))).toMatchObject({
      sort: 'newest', cursor: { value: 1_774_000_000, id: ID, sort: 'newest' },
    });
    expect(() => parseCatalogQuery(new URL(`https://tre.test/api/catalog?sort=name&cursor=${newestCursor}`)))
      .toThrow(CatalogQueryError);
    expect(() => parseCatalogQuery(new URL(`https://tre.test/api/catalog?sort=quality&cursor=${newestCursor}`)))
      .toThrow(CatalogQueryError);
  });

  it('esclude le schede non verificate per default e le include solo su richiesta esplicita', () => {
    expect(parseCatalogQuery(new URL('https://tre.test/api/catalog')).includeUnverified).toBe(false);
    expect(parseCatalogQuery(new URL('https://tre.test/api/catalog?include_unverified=0')).includeUnverified).toBe(false);
    expect(parseCatalogQuery(new URL('https://tre.test/api/catalog?include_unverified=1')).includeUnverified).toBe(true);
  });

  it('attiva il filtro aperti ora soltanto con il valore esplicito 1', () => {
    expect(parseCatalogQuery(new URL('https://tre.test/api/catalog')).openNow).toBe(false);
    expect(parseCatalogQuery(new URL('https://tre.test/api/catalog?open_now=0')).openNow).toBe(false);
    expect(parseCatalogQuery(new URL('https://tre.test/api/catalog?open_now=1')).openNow).toBe(true);
  });

  it.each([
    'limit=51', 'price_min=4&price_max=2', 'lat=45.4', 'lat=95&lng=9',
    'radius_m=99&lat=45.4&lng=9.1', 'bbox=9.2,45.5,9.1,45.4', 'sort=popular', 'category=Rooftop!',
    'include_unverified=true', 'include_unverified=yes', 'open_now=true', 'open_now=', 'subcategory=Non%20valida!',
  ])('rejects invalid input: %s', (query) => {
    expect(() => parseCatalogQuery(new URL(`https://tre.test/api/catalog?${query}`))).toThrow(CatalogQueryError);
  });
});
