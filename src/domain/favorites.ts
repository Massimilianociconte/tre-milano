import { venues as fixtureVenues } from '@/data/venues';
import type { Venue } from '@/domain/venue';

export const FAVORITES_STORAGE_KEY = 'tre-saved-venues';

/** Snapshot minimo persistito in localStorage per schede fixture e catalogo. */
export type SavedVenueEntry = {
  id: string;
  slug: string;
  name: string;
  category: string;
  neighborhood: string;
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  fixtureOnly: boolean;
  averageSpend: number | null;
  travelMinutes: number | null;
  features: string[];
  savedAt: string;
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SAVED = 80;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function isSavedVenueEntry(value: unknown): value is SavedVenueEntry {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.id) || value.id.length > 80) return false;
  if (!isNonEmptyString(value.slug) || value.slug.length > 120 || !SLUG.test(value.slug)) return false;
  if (!isNonEmptyString(value.name) || value.name.length > 160) return false;
  if (!isNonEmptyString(value.category) || value.category.length > 80) return false;
  if (!isNonEmptyString(value.neighborhood) || value.neighborhood.length > 80) return false;
  if (!isNonEmptyString(value.image) || value.image.length > 500) return false;
  if (!isNonEmptyString(value.imageAlt) || value.imageAlt.length > 240) return false;
  if (typeof value.fixtureOnly !== 'boolean') return false;
  if (typeof value.imageWidth !== 'number' || !Number.isFinite(value.imageWidth)) return false;
  if (typeof value.imageHeight !== 'number' || !Number.isFinite(value.imageHeight)) return false;
  if (value.averageSpend !== null && (typeof value.averageSpend !== 'number' || !Number.isFinite(value.averageSpend))) {
    return false;
  }
  if (value.travelMinutes !== null && (typeof value.travelMinutes !== 'number' || !Number.isFinite(value.travelMinutes))) {
    return false;
  }
  if (!Array.isArray(value.features) || !value.features.every((item) => typeof item === 'string')) return false;
  if (!isNonEmptyString(value.savedAt)) return false;
  return true;
}

function fixtureById(id: string): Venue | undefined {
  return fixtureVenues.find((venue) => venue.id === id);
}

function entryFromFixture(venue: Venue, savedAt = new Date().toISOString()): SavedVenueEntry {
  return {
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    category: venue.category,
    neighborhood: venue.neighborhood,
    image: venue.image,
    imageAlt: venue.imageAlt,
    imageWidth: venue.imageWidth,
    imageHeight: venue.imageHeight,
    fixtureOnly: venue.fixtureOnly,
    averageSpend: Number.isFinite(venue.averageSpend) ? venue.averageSpend : null,
    travelMinutes: Number.isFinite(venue.travelEstimate?.minutes) ? venue.travelEstimate.minutes : null,
    features: venue.features.slice(0, 6),
    savedAt,
  };
}

/** Converte una Venue di ranking/podio in entry persistibile. */
export function savedVenueFromVenue(
  venue: Pick<
    Venue,
    | 'id'
    | 'slug'
    | 'name'
    | 'category'
    | 'neighborhood'
    | 'image'
    | 'imageAlt'
    | 'imageWidth'
    | 'imageHeight'
    | 'fixtureOnly'
    | 'averageSpend'
    | 'travelEstimate'
    | 'features'
  >,
  savedAt = new Date().toISOString(),
): SavedVenueEntry {
  return {
    id: venue.id,
    slug: venue.slug,
    name: venue.name,
    category: venue.category,
    neighborhood: venue.neighborhood,
    image: venue.image,
    imageAlt: venue.imageAlt,
    imageWidth: clampInt(venue.imageWidth, 900, 1, 4000),
    imageHeight: clampInt(venue.imageHeight, 1124, 1, 4000),
    fixtureOnly: Boolean(venue.fixtureOnly),
    averageSpend: typeof venue.averageSpend === 'number' && Number.isFinite(venue.averageSpend)
      ? venue.averageSpend
      : null,
    travelMinutes: typeof venue.travelEstimate?.minutes === 'number' && Number.isFinite(venue.travelEstimate.minutes)
      ? venue.travelEstimate.minutes
      : null,
    features: Array.isArray(venue.features)
      ? venue.features.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [],
    savedAt,
  };
}

function normalizeEntry(value: SavedVenueEntry): SavedVenueEntry {
  return {
    id: value.id.trim(),
    slug: value.slug.trim(),
    name: value.name.trim(),
    category: value.category.trim(),
    neighborhood: value.neighborhood.trim(),
    image: value.image.trim(),
    imageAlt: value.imageAlt.trim(),
    imageWidth: clampInt(value.imageWidth, 900, 1, 4000),
    imageHeight: clampInt(value.imageHeight, 1124, 1, 4000),
    fixtureOnly: value.fixtureOnly,
    averageSpend: value.averageSpend === null ? null : clampInt(value.averageSpend, 0, 0, 1_000_000),
    travelMinutes: value.travelMinutes === null ? null : clampInt(value.travelMinutes, 0, 0, 300),
    features: value.features.map((item) => item.trim()).filter(Boolean).slice(0, 6),
    savedAt: value.savedAt,
  };
}

/**
 * Accetta:
 * - formato nuovo: SavedVenueEntry[]
 * - legacy: string[] di id (risolti sulle fixture; gli id catalogo orfani non sono recuperabili)
 */
export function parseSavedVenues(raw: unknown): SavedVenueEntry[] {
  if (!Array.isArray(raw)) return [];

  const byId = new Map<string, SavedVenueEntry>();

  for (const item of raw) {
    if (typeof item === 'string') {
      const fixture = fixtureById(item);
      if (!fixture) continue;
      const entry = entryFromFixture(fixture);
      byId.set(entry.id, entry);
      continue;
    }
    if (!isSavedVenueEntry(item)) continue;
    const entry = normalizeEntry(item);
    // Preferisci la copia più recente se duplicata
    const existing = byId.get(entry.id);
    if (!existing || existing.savedAt <= entry.savedAt) byId.set(entry.id, entry);
  }

  return [...byId.values()]
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, MAX_SAVED);
}

export function readSavedVenuesFromStorage(storage: Storage | null | undefined): SavedVenueEntry[] {
  if (!storage) return [];
  try {
    return parseSavedVenues(JSON.parse(storage.getItem(FAVORITES_STORAGE_KEY) || '[]'));
  } catch {
    return [];
  }
}

export function writeSavedVenuesToStorage(storage: Storage | null | undefined, items: SavedVenueEntry[]) {
  if (!storage) return;
  const payload = parseSavedVenues(items);
  storage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(payload));
}

export function isVenueSaved(items: readonly SavedVenueEntry[], id: string) {
  return items.some((item) => item.id === id);
}

export function toggleSavedVenue(
  items: readonly SavedVenueEntry[],
  venue: Parameters<typeof savedVenueFromVenue>[0],
): { items: SavedVenueEntry[]; saved: boolean } {
  if (isVenueSaved(items, venue.id)) {
    return {
      items: items.filter((item) => item.id !== venue.id),
      saved: false,
    };
  }
  const entry = savedVenueFromVenue(venue);
  return {
    items: parseSavedVenues([entry, ...items]),
    saved: true,
  };
}

export function removeSavedVenue(items: readonly SavedVenueEntry[], id: string) {
  return items.filter((item) => item.id !== id);
}

/** Href coerente: fixture statiche su /locali/, catalogo su /locale/?slug= */
export function savedVenueDetailHref(entry: Pick<SavedVenueEntry, 'fixtureOnly' | 'slug'>) {
  return entry.fixtureOnly
    ? `/locali/${entry.slug}/`
    : `/locale/?slug=${encodeURIComponent(entry.slug)}`;
}
