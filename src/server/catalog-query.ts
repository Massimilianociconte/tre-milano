import type { CatalogSort } from '../domain/catalog-api';

const ALLOWED_SORTS = new Set<CatalogSort>([
  'relevance', 'distance', 'price', 'rating', 'quality', 'name', 'newest',
]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURSOR_TEXT_MAX_BYTES = 240;
const CURSOR_ENCODED_MAX_LENGTH = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class CatalogQueryError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = 'CatalogQueryError';
  }
}

export type CatalogCursor = { value: number | string; id: string; sort?: CatalogSort };

export type ParsedCatalogQuery = {
  query: string | null;
  categorySlugs: string[] | null;
  subcategorySlugs: string[] | null;
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
  includeUnverified: boolean;
  openNow: boolean;
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
  const validValue = typeof cursor.value === 'number'
    ? Number.isFinite(cursor.value)
    : typeof cursor.value === 'string'
      && cursor.value.length > 0
      && encoder.encode(cursor.value).byteLength <= CURSOR_TEXT_MAX_BYTES;
  if (!validValue || !UUID.test(cursor.id) || (cursor.sort !== undefined && !ALLOWED_SORTS.has(cursor.sort))) {
    throw new CatalogQueryError('cursor', 'Cursor non valido.');
  }
  const bytes = encoder.encode(JSON.stringify({ v: cursor.value, i: cursor.id, ...(cursor.sort ? { s: cursor.sort } : {}) }));
  const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (encoded.length > CURSOR_ENCODED_MAX_LENGTH) throw new CatalogQueryError('cursor', 'Cursor non valido.');
  return encoded;
}

export function decodeCatalogCursor(value: string | null): CatalogCursor | null {
  if (!value) return null;
  if (value.length > CURSOR_ENCODED_MAX_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new CatalogQueryError('cursor', 'Cursor non valido.');
  }
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const binary = atob(base64);
    const parsed = JSON.parse(decoder.decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as {
      v?: unknown; i?: unknown; s?: unknown;
    };
    const validValue = (typeof parsed.v === 'number' && Number.isFinite(parsed.v))
      || (typeof parsed.v === 'string'
        && parsed.v.length > 0
        && encoder.encode(parsed.v).byteLength <= CURSOR_TEXT_MAX_BYTES);
    if (!validValue || typeof parsed.i !== 'string' || !UUID.test(parsed.i)
      || (parsed.s !== undefined && (typeof parsed.s !== 'string' || !ALLOWED_SORTS.has(parsed.s as CatalogSort)))) {
      throw new Error('shape');
    }
    return {
      value: parsed.v as number | string,
      id: parsed.i,
      ...(parsed.s ? { sort: parsed.s as CatalogSort } : {}),
    };
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

  const includeUnverifiedValue = url.searchParams.get('include_unverified');
  if (includeUnverifiedValue !== null && includeUnverifiedValue !== '1' && includeUnverifiedValue !== '0') {
    throw new CatalogQueryError('include_unverified', 'include_unverified accetta solo 0 o 1.');
  }
  const openNowValue = url.searchParams.get('open_now');
  if (openNowValue !== null && openNowValue !== '1' && openNowValue !== '0') {
    throw new CatalogQueryError('open_now', 'open_now accetta solo 0 o 1.');
  }

  const cursor = decodeCatalogCursor(url.searchParams.get('cursor'));
  if (cursor && (((sortCandidate === 'name') !== (typeof cursor.value === 'string'))
    || (cursor.sort !== undefined && cursor.sort !== sortCandidate))) {
    throw new CatalogQueryError('cursor', 'Il cursor non appartiene a questo ordinamento.');
  }

  return {
    query,
    categorySlugs: parseSlugs(url.searchParams.getAll('category'), 'category'),
    subcategorySlugs: parseSlugs(url.searchParams.getAll('subcategory'), 'subcategory'),
    neighborhoodSlugs: parseSlugs(url.searchParams.getAll('neighborhood'), 'neighborhood'),
    serviceSlugs: parseSlugs(url.searchParams.getAll('service'), 'service'),
    minPriceLevel,
    maxPriceLevel,
    latitude,
    longitude,
    radiusMeters,
    bbox,
    sort: sortCandidate,
    cursor,
    limit,
    includeUnverified: includeUnverifiedValue === '1',
    openNow: openNowValue === '1',
  };
}
