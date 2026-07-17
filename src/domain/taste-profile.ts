import { hasKnownVenuePricing, type Venue } from './venue';

export const TASTE_PROFILE_VERSION = 1 as const;
export const TASTE_PROFILE_STORAGE_KEY = `tre-milano:taste-profile:v${TASTE_PROFILE_VERSION}`;
export const TASTE_PROFILE_CHANGE_EVENT = 'tre-milano:taste-profile-change';
export const TASTE_PROFILE_SCORE_CAP = 4;

export type TastePreferenceKey =
  | 'atmosphere'
  | 'energy'
  | 'experimentation'
  | 'sociality'
  | 'budget';

export type TastePreferenceDefinition = {
  key: TastePreferenceKey;
  label: string;
  values: readonly string[];
  neutralValue: number;
};

export const TASTE_PREFERENCES: readonly TastePreferenceDefinition[] = [
  { key: 'atmosphere', label: 'Atmosfera', values: ['Rilassata', 'Informale', 'Equilibrata', 'Raffinata', 'Esclusiva'], neutralValue: 2 },
  { key: 'energy', label: 'Energia', values: ['Tranquilla', 'Soffusa', 'Equilibrata', 'Animata', 'Vivace'], neutralValue: 2 },
  { key: 'experimentation', label: 'Sperimentazione', values: ['Classica', 'Contemporanea', 'Equilibrata', 'Creativa', 'Sperimentale'], neutralValue: 2 },
  { key: 'sociality', label: 'Socialità', values: ['Intima', 'Raccolta', 'Equilibrata', 'Conviviale', 'Sociale'], neutralValue: 2 },
  { key: 'budget', label: 'Budget', values: ['€', '€€', '€€€', '€€€€'], neutralValue: 2 },
] as const;

export const TASTE_INTERESTS = [
  'Rooftop',
  'Cocktail bar',
  'Ristoranti',
  'Design',
  'Aperitivo',
  'Vista Duomo',
  'Brera',
  'Musica live',
] as const;

export type TasteInterest = (typeof TASTE_INTERESTS)[number];

/**
 * Only keys present in `preferences` were explicitly declared by the person.
 * An absent key is deliberately different from a neutral/default preference.
 */
export type TasteProfile = {
  version: typeof TASTE_PROFILE_VERSION;
  state: 'active' | 'suspended';
  preferences: Partial<Record<TastePreferenceKey, number>>;
  interests: TasteInterest[];
};

export type TasteProfileChangeDetail = {
  profile: TasteProfile | null;
};

export type TasteProfileAffinity = {
  score: number;
  matches: string[];
};

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem'>;

const preferenceByKey = new Map(TASTE_PREFERENCES.map((preference) => [preference.key, preference]));

export function createEmptyTasteProfile(state: TasteProfile['state'] = 'active'): TasteProfile {
  return {
    version: TASTE_PROFILE_VERSION,
    state,
    preferences: {},
    interests: [],
  };
}

function isTastePreferenceKey(value: string): value is TastePreferenceKey {
  return preferenceByKey.has(value as TastePreferenceKey);
}

function validPreferenceValue(key: TastePreferenceKey, value: unknown): value is number {
  const definition = preferenceByKey.get(key);
  return Boolean(
    definition
      && typeof value === 'number'
      && Number.isInteger(value)
      && value >= 0
      && value < definition.values.length,
  );
}

function sanitiseInterests(value: unknown): TasteInterest[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(TASTE_INTERESTS);
  return [...new Set(value.filter((item): item is TasteInterest => typeof item === 'string' && allowed.has(item)))];
}

function sanitisePreferences(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.entries(value).reduce<TasteProfile['preferences']>((result, [key, preferenceValue]) => {
    if (isTastePreferenceKey(key) && validPreferenceValue(key, preferenceValue)) result[key] = preferenceValue;
    return result;
  }, {});
}

/**
 * Accepts the current schema and safely migrates the previous unversioned UI
 * payload. Legacy neutral slider defaults are omitted because they were never
 * proof of an explicit preference.
 */
export function parseTasteProfile(value: string | null): TasteProfile | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    if (parsed.version === TASTE_PROFILE_VERSION) {
      return {
        version: TASTE_PROFILE_VERSION,
        state: parsed.state === 'suspended' ? 'suspended' : 'active',
        preferences: sanitisePreferences(parsed.preferences),
        interests: sanitiseInterests(parsed.interests),
      };
    }

    // Never reinterpret a future schema as the legacy prototype.
    if ('version' in parsed) return null;

    // Migration from the original unversioned v1 prototype.
    const legacyPreferences = sanitisePreferences(parsed.preferences);
    for (const definition of TASTE_PREFERENCES) {
      if (legacyPreferences[definition.key] === definition.neutralValue) {
        delete legacyPreferences[definition.key];
      }
    }

    return {
      version: TASTE_PROFILE_VERSION,
      state: 'active',
      preferences: legacyPreferences,
      interests: sanitiseInterests(parsed.interests),
    };
  } catch {
    return null;
  }
}

export function readTasteProfile(storage: StorageReader): TasteProfile | null {
  return parseTasteProfile(storage.getItem(TASTE_PROFILE_STORAGE_KEY));
}

export function serialiseTasteProfile(profile: TasteProfile, pretty = false) {
  return JSON.stringify(profile, null, pretty ? 2 : undefined);
}

/**
 * Writes the compact canonical payload synchronously. The profile is small and
 * local-only, so committing in the same user interaction prevents a final
 * slider or chip change from being lost during immediate navigation.
 */
export function persistTasteProfile(storage: StorageWriter, profile: TasteProfile) {
  const payload = serialiseTasteProfile(profile);
  storage.setItem(TASTE_PROFILE_STORAGE_KEY, payload);
  return payload;
}

export function tasteProfileSignalCount(profile: TasteProfile | null | undefined) {
  if (!profile) return 0;
  return Object.keys(profile.preferences).length + profile.interests.length;
}

export function isTasteProfileActive(profile: TasteProfile | null | undefined): profile is TasteProfile {
  return Boolean(profile && profile.state === 'active' && tasteProfileSignalCount(profile) > 0);
}

const normalise = (value: string) => value
  .toLocaleLowerCase('it-IT')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[’'`]/g, ' ')
  .replace(/[^a-z0-9€]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

function venueText(venue: Venue) {
  return normalise([
    venue.name,
    venue.neighborhood,
    venue.category,
    ...venue.atmosphere,
    ...venue.occasions,
    ...venue.features,
    ...(venue.semanticTags ?? []),
  ].join(' '));
}

function includesAny(text: string, terms: readonly string[]) {
  return terms.some((term) => text.includes(normalise(term)));
}

const INTEREST_MATCHERS: Record<TasteInterest, (venue: Venue, text: string) => boolean> = {
  Rooftop: (venue) => venue.category === 'Rooftop',
  'Cocktail bar': (venue) => venue.category === 'Cocktail bar',
  Ristoranti: (venue) => venue.category === 'Ristorante',
  Design: (_venue, text) => includesAny(text, ['design', 'architettura', 'interni curati']),
  Aperitivo: (venue) => venue.occasions.includes('aperitivo'),
  'Vista Duomo': (_venue, text) => includesAny(text, ['vista Duomo', 'skyline', 'Duomo']),
  Brera: (venue) => venue.neighborhood === 'Brera',
  'Musica live': (_venue, text) => includesAny(text, ['musica', 'live music', 'concerto', 'dj set']),
};

function preferenceMatch(venue: Venue, text: string, key: TastePreferenceKey, value: number) {
  if (key === 'budget') {
    if (!hasKnownVenuePricing(venue)) return 0;
    const distance = Math.abs(venue.priceLevel - (value + 1));
    return distance === 0 ? 0.55 : distance === 1 ? 0.22 : 0;
  }
  if (value === 2) return 0;

  const terms: Record<Exclude<TastePreferenceKey, 'budget'>, readonly [readonly string[], readonly string[]]> = {
    atmosphere: [['rilassato', 'informale', 'autentico'], ['elegante', 'raffinato', 'esclusivo']],
    energy: [['tranquillo', 'silenzioso', 'senza fretta'], ['vivace', 'animato', 'sociale', 'energia alta']],
    experimentation: [['classico', 'autentico', 'tradizionale'], ['creativo', 'contemporaneo', 'cocktail d autore', 'design']],
    sociality: [['intimo', 'raccolto', 'romantico'], ['conviviale', 'sociale', 'gruppi', 'socializzare']],
  };
  const side = value < 2 ? 0 : 1;
  return includesAny(text, terms[key][side]) ? (Math.abs(value - 2) === 2 ? 0.7 : 0.5) : 0;
}

/**
 * Computes a deliberately weak, explainable affinity. It is called only after
 * hard-constraint filtering and is capped so declared taste can refine, never
 * manufacture, an eligible result.
 */
export function tasteProfileAffinity(venue: Venue, profile: TasteProfile | null | undefined): TasteProfileAffinity {
  if (!isTasteProfileActive(profile)) return { score: 0, matches: [] };

  const text = venueText(venue);
  let score = 0;
  const matches: string[] = [];

  for (const interest of profile.interests) {
    if (!INTEREST_MATCHERS[interest](venue, text)) continue;
    score += 0.65;
    matches.push(interest);
  }

  for (const [key, value] of Object.entries(profile.preferences)) {
    if (!isTastePreferenceKey(key) || !validPreferenceValue(key, value)) continue;
    const preferenceScore = preferenceMatch(venue, text, key, value);
    if (!preferenceScore) continue;
    score += preferenceScore;
    const definition = preferenceByKey.get(key);
    matches.push(`${definition?.label}: ${definition?.values[value]}`);
  }

  return {
    score: Number(Math.min(score, TASTE_PROFILE_SCORE_CAP).toFixed(4)),
    matches: [...new Set(matches)],
  };
}
