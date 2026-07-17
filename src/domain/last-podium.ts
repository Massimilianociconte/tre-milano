import { NEIGHBORHOOD_NAMES } from './neighborhoods';
import type { SearchIntent, VenueCategory } from './venue';

export const LAST_PODIUM_SCHEMA_VERSION = 1 as const;
export const LAST_PODIUM_STORAGE_KEY = 'tre-milano:last-podium:v1';
export const LAST_PODIUM_TTL_MS = 4 * 60 * 60 * 1000;
const LAST_PODIUM_MAX_TTL_MS = 6 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const CATEGORIES = ['Cocktail bar', 'Ristorante', 'Enoteca', 'Rooftop', 'Caffè'] as const;
const NEIGHBORHOODS = ['Milano', ...NEIGHBORHOOD_NAMES] as const;
const ATMOSPHERES = [
  'intimo', 'elegante', 'tranquillo', 'romantico', 'vivace', 'panoramico',
  'rilassato', 'autentico', 'contemporaneo', 'creativo', 'luminoso', 'sociale',
] as const;
const OCCASIONS = [
  'aperitivo', 'appuntamento', 'cena romantica', 'amici', 'occasione speciale',
  'ospite fuori città', 'brunch', 'lavoro', 'dopo cena',
] as const;
const CONCEPTS = [
  'vista Duomo', 'vista canale', 'vista iconica', 'spazio all’aperto',
  'conversazione', 'vino naturale', 'cocktail d’autore', 'alta cucina',
  'vegetariano', 'musica', 'design', 'lavorare', 'prenotazione', 'tramonto',
] as const;
const TRAVEL_ORIGINS = ['milano-duomo-centroid'] as const;
const VENUE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const INTENT_KEYS = [
  'categories', 'requiredCategories', 'excludedCategories',
  'neighborhoods', 'requiredNeighborhoods', 'excludedNeighborhoods',
  'atmosphere', 'requiredAtmosphere', 'requiredAtmosphereAny', 'excludedAtmosphere',
  'occasions', 'excludedOccasions',
  'concepts', 'requiredConcepts', 'excludedConcepts',
  'requiresOpenNow',
] as const;
const INTENT_OPTIONAL_KEYS = ['minSpend', 'maxSpend', 'maxMinutes', 'travelOriginId', 'requestedServiceTime'] as const;

export type LastPodiumIntentV1 = {
  categories: VenueCategory[];
  requiredCategories: VenueCategory[];
  excludedCategories: VenueCategory[];
  neighborhoods: string[];
  requiredNeighborhoods: string[];
  excludedNeighborhoods: string[];
  minSpend?: number;
  maxSpend?: number;
  maxMinutes?: number;
  travelOriginId?: 'milano-duomo-centroid';
  requiresOpenNow: boolean;
  requestedServiceTime?: { weekday: number; minutes: number };
  atmosphere: string[];
  requiredAtmosphere: string[];
  requiredAtmosphereAny: string[];
  excludedAtmosphere: string[];
  occasions: string[];
  excludedOccasions: string[];
  concepts: string[];
  requiredConcepts: string[];
  excludedConcepts: string[];
};

export type LastPodiumSnapshotV1 = {
  version: typeof LAST_PODIUM_SCHEMA_VERSION;
  createdAt: number;
  expiresAt: number;
  venueIds: string[];
  intent: LastPodiumIntentV1;
};

export type LastPodiumStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []) {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key));
}

function isIntegerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isTaxonomyArray(value: unknown, allowed: readonly string[], maximum = 32): value is string[] {
  return Array.isArray(value)
    && value.length <= maximum
    && new Set(value).size === value.length
    && value.every((item) => typeof item === 'string' && allowed.includes(item));
}

function validIntent(value: unknown): value is LastPodiumIntentV1 {
  if (!isPlainRecord(value) || !hasExactKeys(value, INTENT_KEYS, INTENT_OPTIONAL_KEYS)) return false;
  if (!isTaxonomyArray(value.categories, CATEGORIES, CATEGORIES.length)) return false;
  if (!isTaxonomyArray(value.requiredCategories, CATEGORIES, CATEGORIES.length)) return false;
  if (!isTaxonomyArray(value.excludedCategories, CATEGORIES, CATEGORIES.length)) return false;
  if (!isTaxonomyArray(value.neighborhoods, NEIGHBORHOODS)) return false;
  if (!isTaxonomyArray(value.requiredNeighborhoods, NEIGHBORHOODS)) return false;
  if (!isTaxonomyArray(value.excludedNeighborhoods, NEIGHBORHOODS)) return false;
  if (!isTaxonomyArray(value.atmosphere, ATMOSPHERES)) return false;
  if (!isTaxonomyArray(value.requiredAtmosphere, ATMOSPHERES)) return false;
  if (!isTaxonomyArray(value.requiredAtmosphereAny, ATMOSPHERES)) return false;
  if (!isTaxonomyArray(value.excludedAtmosphere, ATMOSPHERES)) return false;
  if (!isTaxonomyArray(value.occasions, OCCASIONS)) return false;
  if (!isTaxonomyArray(value.excludedOccasions, OCCASIONS)) return false;
  if (!isTaxonomyArray(value.concepts, CONCEPTS)) return false;
  if (!isTaxonomyArray(value.requiredConcepts, CONCEPTS)) return false;
  if (!isTaxonomyArray(value.excludedConcepts, CONCEPTS)) return false;
  if (typeof value.requiresOpenNow !== 'boolean') return false;
  if (value.minSpend !== undefined && !isIntegerBetween(value.minSpend, 1, 1_000)) return false;
  if (value.maxSpend !== undefined && !isIntegerBetween(value.maxSpend, 1, 1_000)) return false;
  if (value.minSpend !== undefined && value.maxSpend !== undefined && value.minSpend > value.maxSpend) return false;
  if (value.maxMinutes !== undefined && !isIntegerBetween(value.maxMinutes, 1, 240)) return false;
  if (value.travelOriginId !== undefined && !TRAVEL_ORIGINS.includes(value.travelOriginId as 'milano-duomo-centroid')) return false;
  if (value.requestedServiceTime !== undefined) {
    if (!isPlainRecord(value.requestedServiceTime)) return false;
    if (!hasExactKeys(value.requestedServiceTime, ['weekday', 'minutes'])) return false;
    if (!isIntegerBetween(value.requestedServiceTime.weekday, 0, 6)) return false;
    if (!isIntegerBetween(value.requestedServiceTime.minutes, 0, 1_439)) return false;
  }
  return true;
}

export function parseLastPodiumSnapshot(value: unknown, now = Date.now()): LastPodiumSnapshotV1 | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['version', 'createdAt', 'expiresAt', 'venueIds', 'intent'])) return null;
  if (value.version !== LAST_PODIUM_SCHEMA_VERSION) return null;
  if (!Number.isFinite(now) || !isIntegerBetween(value.createdAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (!isIntegerBetween(value.expiresAt, 0, Number.MAX_SAFE_INTEGER)) return null;
  if (value.createdAt > now + CLOCK_SKEW_MS || value.expiresAt <= now) return null;
  if (value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > LAST_PODIUM_MAX_TTL_MS) return null;
  if (!Array.isArray(value.venueIds) || value.venueIds.length < 1 || value.venueIds.length > 3) return null;
  if (new Set(value.venueIds).size !== value.venueIds.length) return null;
  if (!value.venueIds.every((id) => typeof id === 'string' && VENUE_ID.test(id) && id.length <= 80)) return null;
  if (!validIntent(value.intent)) return null;
  return structuredClone(value) as LastPodiumSnapshotV1;
}

function taxonomyCopy(values: readonly string[], allowed: readonly string[], label: string) {
  if (!isTaxonomyArray(values, allowed)) throw new TypeError(`${label} contiene valori non tassonomizzati.`);
  return [...values];
}

export function createLastPodiumSnapshot(
  venueIds: readonly string[],
  intent: SearchIntent,
  now = Date.now(),
): LastPodiumSnapshotV1 {
  const candidate: LastPodiumSnapshotV1 = {
    version: LAST_PODIUM_SCHEMA_VERSION,
    createdAt: now,
    expiresAt: now + LAST_PODIUM_TTL_MS,
    venueIds: [...venueIds],
    intent: {
      categories: taxonomyCopy(intent.categories, CATEGORIES, 'categories') as VenueCategory[],
      requiredCategories: taxonomyCopy(intent.requiredCategories, CATEGORIES, 'requiredCategories') as VenueCategory[],
      excludedCategories: taxonomyCopy(intent.excludedCategories, CATEGORIES, 'excludedCategories') as VenueCategory[],
      neighborhoods: taxonomyCopy(intent.neighborhoods, NEIGHBORHOODS, 'neighborhoods'),
      requiredNeighborhoods: taxonomyCopy(intent.requiredNeighborhoods, NEIGHBORHOODS, 'requiredNeighborhoods'),
      excludedNeighborhoods: taxonomyCopy(intent.excludedNeighborhoods, NEIGHBORHOODS, 'excludedNeighborhoods'),
      ...(intent.minSpend !== undefined ? { minSpend: intent.minSpend } : {}),
      ...(intent.maxSpend !== undefined ? { maxSpend: intent.maxSpend } : {}),
      ...(intent.maxMinutes !== undefined ? { maxMinutes: intent.maxMinutes } : {}),
      ...(intent.travelOriginId === 'milano-duomo-centroid' ? { travelOriginId: intent.travelOriginId } : {}),
      requiresOpenNow: intent.requiresOpenNow,
      ...(intent.requestedServiceTime ? {
        requestedServiceTime: {
          weekday: intent.requestedServiceTime.weekday,
          minutes: intent.requestedServiceTime.minutes,
        },
      } : {}),
      atmosphere: taxonomyCopy(intent.atmosphere, ATMOSPHERES, 'atmosphere'),
      requiredAtmosphere: taxonomyCopy(intent.requiredAtmosphere, ATMOSPHERES, 'requiredAtmosphere'),
      requiredAtmosphereAny: taxonomyCopy(intent.requiredAtmosphereAny, ATMOSPHERES, 'requiredAtmosphereAny'),
      excludedAtmosphere: taxonomyCopy(intent.excludedAtmosphere, ATMOSPHERES, 'excludedAtmosphere'),
      occasions: taxonomyCopy(intent.occasions, OCCASIONS, 'occasions'),
      excludedOccasions: taxonomyCopy(intent.excludedOccasions, OCCASIONS, 'excludedOccasions'),
      concepts: taxonomyCopy(intent.concepts, CONCEPTS, 'concepts'),
      requiredConcepts: taxonomyCopy(intent.requiredConcepts, CONCEPTS, 'requiredConcepts'),
      excludedConcepts: taxonomyCopy(intent.excludedConcepts, CONCEPTS, 'excludedConcepts'),
    },
  };
  const parsed = parseLastPodiumSnapshot(candidate, now);
  if (!parsed) throw new TypeError('Il podio non rispetta lo schema offline v1.');
  return parsed;
}

export function writeLastPodium(
  storage: LastPodiumStorage,
  venueIds: readonly string[],
  intent: SearchIntent,
  now = Date.now(),
) {
  const snapshot = createLastPodiumSnapshot(venueIds, intent, now);
  storage.setItem(LAST_PODIUM_STORAGE_KEY, JSON.stringify(snapshot));
  return snapshot;
}

export function readLastPodium(storage: LastPodiumStorage, now = Date.now()) {
  let raw: string | null = null;
  try {
    raw = storage.getItem(LAST_PODIUM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseLastPodiumSnapshot(JSON.parse(raw), now);
    if (parsed) return parsed;
  } catch {
    // Invalid or unavailable storage is treated as an empty, recoverable cache.
  }
  try { storage.removeItem(LAST_PODIUM_STORAGE_KEY); } catch { /* best effort */ }
  return null;
}

export function clearLastPodium(storage: LastPodiumStorage) {
  storage.removeItem(LAST_PODIUM_STORAGE_KEY);
}

function serviceTimeLabel(weekday: number, minutes: number) {
  const hour = Math.floor(minutes / 60).toString().padStart(2, '0');
  const minute = (minutes % 60).toString().padStart(2, '0');
  return `giorno ${weekday} alle ${hour}:${minute}`;
}

export function lastPodiumIntentToOverrides(intent: LastPodiumIntentV1): Partial<SearchIntent> {
  return {
    category: intent.categories[0],
    categories: [...intent.categories],
    requiredCategories: [...intent.requiredCategories],
    excludedCategories: [...intent.excludedCategories],
    neighborhood: intent.neighborhoods[0],
    neighborhoods: [...intent.neighborhoods],
    requiredNeighborhoods: [...intent.requiredNeighborhoods],
    excludedNeighborhoods: [...intent.excludedNeighborhoods],
    minSpend: intent.minSpend,
    maxSpend: intent.maxSpend,
    maxMinutes: intent.maxMinutes,
    travelOriginId: intent.travelOriginId,
    requiresOpenNow: intent.requiresOpenNow,
    requestedServiceTime: intent.requestedServiceTime ? {
      ...intent.requestedServiceTime,
      label: serviceTimeLabel(intent.requestedServiceTime.weekday, intent.requestedServiceTime.minutes),
    } : undefined,
    atmosphere: [...intent.atmosphere],
    requiredAtmosphere: [...intent.requiredAtmosphere],
    requiredAtmosphereAny: [...intent.requiredAtmosphereAny],
    excludedAtmosphere: [...intent.excludedAtmosphere],
    occasion: intent.occasions[0],
    occasions: [...intent.occasions],
    excludedOccasions: [...intent.excludedOccasions],
    concepts: [...intent.concepts],
    requiredConcepts: [...intent.requiredConcepts],
    excludedConcepts: [...intent.excludedConcepts],
  };
}
