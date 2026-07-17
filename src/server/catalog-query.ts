import type { CatalogSort } from '../domain/catalog-api';

const ALLOWED_SORTS = new Set<CatalogSort>(['relevance', 'distance', 'price', 'rating', 'quality']);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CatalogQueryError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'CatalogQueryError';
  }
}

export type CatalogCursor = { value: number; id: string };

export type ParsedCatalogQuery = {
  query: string | null;
  categorySlugs: string[] | null;
  neighborhoodSlugs: string[] | null;
  serviceSlugs: string[] | null;
  minPriceLevel: number | null;
  maxPriceLevel: number | null;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  bbox: [number, number, number, number] | null;
  sort: CatalogSort;
  cursor: CatalogCursor | null;
  limit: number;
};

const parseNumber = (value: string | null, field: string) => {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new CatalogQueryError(field, `${field} deve essere numerico.`);
  return parsed;
};

const parseSlugs = (values: string[], field: string) => {
  const slugs = [...new Set(values.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean))];
  if (!slugs.length) return null;
  if (slugs.length > 20 || slugs.some((slug) => !SLUG.test(slug))) {
    throw new CatalogQueryError(field, `${field} contiene valori non validi.`);
  }
  return slugs;
};

export function encodeCatalogCursor(cursor: CatalogCursor) {
  if (!Number.isFinite(cursor.value) || !UUID.test(cursor.id)) throw new CatalogQueryError('cursor', 'Cursor non valido.');
  return btoa(JSON.stringify({ v: cursor.value, i: cursor.id })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCatalogCursor(value: string | null): CatalogCursor | null {
  if (!value) return null;
  if (value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new CatalogQueryError('cursor', 'Cursor non valido.');
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(base64)) as { v?: unknown; i?: unknown };
    if (typeof parsed.v !== 'number' || !Number.isFinite(parsed.v) || typeof parsed.i !== 'string' || !UUID.test(parsed.i)) {
      throw new Error('shape');
    }
    return { value: parsed.v, id: parsed.i };
  } catch {
    throw new CatalogQueryError('cursor', 'Cursor non valido.');
  }
}

export function parseCatalogQuery(url: URL): ParsedCatalogQuery {
  const query = url.searchParams.get('q')?.trim() || null;
  if (query && query.length > 200) throw new CatalogQueryError('q', 'La ricerca supera 200 caratteri.');

  const sortCandidate = (url.searchParams.get('sort') || 'relevance') as CatalogSort;
  if (!ALLOWED_SORTS.has(sortCandidate)) throw new CatalogQueryError('sort', 'Ordinamento non supportato.');

  const minPriceLevel = parseNumber(url.searchParams.get('price_min'), 'price_min');
  const maxPriceLevel = parseNumber(url.searchParams.get('price_max'), 'price_max');
  if (minPriceLevel !== null && (!Number.isInteger(minPriceLevel) || minPriceLevel < 1 || minPriceLevel > 4)) {
    throw new CatalogQueryError('price_min', 'price_min deve essere tra 1 e 4.');
  }
  if (maxPriceLevel !== null && (!Number.isInteger(maxPriceLevel) || maxPriceLevel < 1 || maxPriceLevel > 4)) {
    throw new CatalogQueryError('price_max', 'price_max deve essere tra 1 e 4.');
  }
  if (minPriceLevel !== null && maxPriceLevel !== null && minPriceLevel > maxPriceLevel) {
    throw new CatalogQueryError('price', 'Intervallo prezzo non valido.');
  }

  const latitude = parseNumber(url.searchParams.get('lat'), 'lat');
  const longitude = parseNumber(url.searchParams.get('lng'), 'lng');
  if ((latitude === null) !== (longitude === null)) throw new CatalogQueryError('location', 'Latitudine e longitudine sono entrambe necessarie.');
  if (latitude !== null && (latitude < -90 || latitude > 90 || longitude! < -180 || longitude! > 180)) {
    throw new CatalogQueryError('location', 'Coordinate non valide.');
  }

  const radiusMeters = parseNumber(url.searchParams.get('radius_m'), 'radius_m');
  if (radiusMeters !== null && (latitude === null || !Number.isInteger(radiusMeters) || radiusMeters < 100 || radiusMeters > 50_000)) {
    throw new CatalogQueryError('radius_m', 'Il raggio deve essere tra 100 e 50000 metri e richiede un’origine.');
  }

  let bbox: ParsedCatalogQuery['bbox'] = null;
  const bboxValue = url.searchParams.get('bbox');
  if (bboxValue) {
    const parts = bboxValue.split(',').map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) throw new CatalogQueryError('bbox', 'Bounding box non valida.');
    const [minLng, minLat, maxLng, maxLat] = parts;
    if (minLng >= maxLng || minLat >= maxLat || minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
      throw new CatalogQueryError('bbox', 'Bounding box non valida.');
    }
    bbox = [minLat, minLng, maxLat, maxLng];
  }

  const limit = parseNumber(url.searchParams.get('limit'), 'limit') ?? 24;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new CatalogQueryError('limit', 'Il limite deve essere tra 1 e 50.');

  return {
    query,
    categorySlugs: parseSlugs(url.searchParams.getAll('category'), 'category'),
    neighborhoodSlugs: parseSlugs(url.searchParams.getAll('neighborhood'), 'neighborhood'),
    serviceSlugs: parseSlugs(url.searchParams.getAll('service'), 'service'),
    minPriceLevel,
    maxPriceLevel,
    latitude,
    longitude,
    radiusMeters,
    bbox,
    sort: sortCandidate,
    cursor: decodeCatalogCursor(url.searchParams.get('cursor')),
    limit,
  };
}
