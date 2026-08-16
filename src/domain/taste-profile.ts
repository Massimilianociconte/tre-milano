import { hasKnownVenuePricing, type Venue } from './venue';

export const TASTE_PROFILE_VERSION = 1 as const;
export const TASTE_PROFILE_STORAGE_KEY = `tre-milano:taste-profile:v${TASTE_PROFILE_VERSION}`;
export const TASTE_PROFILE_CHANGE_EVENT = 'tre-milano:taste-profile-change';

/**
 * Pesi deterministici del profilo locale.
 * Devono restare inferiori a un match di categoria/quartiere forte (~18–24),
 * ma alti abbastanza da riordinare candidati già ammissibili.
 */
export const TASTE_PROFILE_WEIGHTS = Object.freeze({
  /** Cap sul contributo totale al punteggio di ranking. */
  totalCap: 16,
  /** Peso massimo di un asse continuo a intensità piena e accordo pieno. */
  continuumMax: 3.9,
  /** Peso massimo del budget a intensità piena e fascia esatta. */
  budgetMax: 3.6,
  /** Peso di ogni interesse esplicito (chip) che combacia. */
  interestHit: 3.15,
  /** Fattore delle penalità relative alle ricompense (mismatch non deve dominare). */
  mismatchRatio: 0.42,
  /** Saturazione soft: raw → cap * (1 - e^{-raw/scale}). */
  saturationScale: 14,
} as const);

/** @deprecated Use TASTE_PROFILE_WEIGHTS.totalCap — kept for import compatibility in tests. */
export const TASTE_PROFILE_SCORE_CAP = TASTE_PROFILE_WEIGHTS.totalCap;

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
  /** Dettaglio deterministico per debug/test: contributi grezzi prima della saturazione. */
  breakdown?: ReadonlyArray<{ key: string; contribution: number }>;
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

function venueCorpus(venue: Venue) {
  return {
    text: normalise([
      venue.name,
      venue.neighborhood,
      venue.category,
      ...venue.atmosphere,
      ...venue.occasions,
      ...venue.features,
      ...(venue.semanticTags ?? []),
    ].join(' ')),
    atmospheres: new Set(venue.atmosphere.map(normalise)),
    occasions: new Set(venue.occasions.map(normalise)),
    features: new Set(venue.features.map(normalise)),
    tags: new Set((venue.semanticTags ?? []).map(normalise)),
    category: normalise(venue.category),
    neighborhood: normalise(venue.neighborhood),
  };
}

type VenueCorpus = ReturnType<typeof venueCorpus>;

function termHits(corpus: VenueCorpus, terms: readonly string[]) {
  let hits = 0;
  for (const term of terms) {
    const token = normalise(term);
    if (!token) continue;
    if (
      corpus.text.includes(token)
      || corpus.atmospheres.has(token)
      || corpus.occasions.has(token)
      || corpus.features.has(token)
      || corpus.tags.has(token)
      || corpus.category === token
      || corpus.neighborhood === token
    ) {
      hits += 1;
    }
  }
  return hits;
}

/** Soft presence in 0..1 from discrete hit counts (diminishing returns). */
function softPresence(hits: number) {
  if (hits <= 0) return 0;
  if (hits === 1) return 0.55;
  if (hits === 2) return 0.82;
  return 1;
}

/**
 * Asse continuo: low = sinistra dello slider, high = destra.
 * `atmospheres` mappa valori controllati del catalogo.
 */
type ContinuumAxis = {
  lowTerms: readonly string[];
  highTerms: readonly string[];
  lowAtmospheres: readonly string[];
  highAtmospheres: readonly string[];
};

const CONTINUUM_AXES: Record<Exclude<TastePreferenceKey, 'budget'>, ContinuumAxis> = {
  atmosphere: {
    lowTerms: ['rilassato', 'informale', 'autentico', 'easy', 'senza fretta', 'locale silenzioso'],
    highTerms: ['elegante', 'raffinato', 'esclusivo', 'chic', 'sofisticato', 'alta cucina'],
    lowAtmospheres: ['rilassato', 'autentico', 'intimo', 'tranquillo'],
    highAtmospheres: ['elegante', 'contemporaneo', 'creativo', 'luminoso'],
  },
  energy: {
    lowTerms: ['tranquillo', 'silenzioso', 'senza fretta', 'calmo', 'poco rumore', 'conversazione'],
    highTerms: ['vivace', 'animato', 'energia alta', 'rumoroso', 'movimentato', 'musica alta', 'dj set'],
    lowAtmospheres: ['tranquillo', 'intimo', 'romantico', 'rilassato'],
    highAtmospheres: ['vivace', 'sociale', 'creativo'],
  },
  experimentation: {
    lowTerms: ['classico', 'tradizionale', 'autentico', 'tipico', 'trattoria'],
    highTerms: ['creativo', 'contemporaneo', 'sperimentale', 'cocktail d autore', 'mixology', 'design', 'innovativo'],
    lowAtmospheres: ['autentico', 'rilassato'],
    highAtmospheres: ['creativo', 'contemporaneo'],
  },
  sociality: {
    lowTerms: ['intimo', 'raccolto', 'romantico', 'riservato', 'privacy', 'per due'],
    highTerms: ['conviviale', 'sociale', 'gruppi', 'socializzare', 'compagnia', 'tavolate'],
    lowAtmospheres: ['intimo', 'romantico', 'tranquillo'],
    highAtmospheres: ['sociale', 'vivace'],
  },
};

function continuumLean(corpus: VenueCorpus, axis: ContinuumAxis) {
  const lowHits = termHits(corpus, axis.lowTerms)
    + [...axis.lowAtmospheres].filter((item) => corpus.atmospheres.has(normalise(item))).length;
  const highHits = termHits(corpus, axis.highTerms)
    + [...axis.highAtmospheres].filter((item) => corpus.atmospheres.has(normalise(item))).length;
  const low = softPresence(lowHits);
  const high = softPresence(highHits);
  // Lean in [-1, 1]: negativo = polo basso, positivo = polo alto.
  if (low === 0 && high === 0) return 0;
  return (high - low) / Math.max(high + low, 1e-9);
}

function preferenceIntensity(key: TastePreferenceKey, value: number) {
  const definition = preferenceByKey.get(key)!;
  const neutral = definition.neutralValue;
  const maxDist = Math.max(neutral, definition.values.length - 1 - neutral);
  if (maxDist <= 0) return 0;
  return Math.min(1, Math.abs(value - neutral) / maxDist);
}

/**
 * Accordo continuo [-1, 1] tra posizione slider e lean del locale.
 * Intensità e accordo determinano ricompensa o leggera penalità.
 */
function continuumContribution(
  corpus: VenueCorpus,
  key: Exclude<TastePreferenceKey, 'budget'>,
  value: number,
) {
  const definition = preferenceByKey.get(key)!;
  if (value === definition.neutralValue) return { contribution: 0, matchLabel: null as string | null };

  const intensity = preferenceIntensity(key, value);
  if (intensity <= 0) return { contribution: 0, matchLabel: null as string | null };

  const preferredLean = (value - definition.neutralValue)
    / Math.max(definition.neutralValue, definition.values.length - 1 - definition.neutralValue);
  const venueLean = continuumLean(corpus, CONTINUUM_AXES[key]);

  // Accordo direzionale: stesso segno e intensità comparabile → alto.
  // Se il locale non ha segnale (lean≈0), contributo quasi nullo (né premio né castigo).
  if (Math.abs(venueLean) < 0.08) {
    return { contribution: 0, matchLabel: null as string | null };
  }

  const agreement = preferredLean * venueLean; // -1..1
  const magnitude = intensity * Math.min(1, Math.abs(venueLean) * 1.15);
  let contribution: number;
  if (agreement >= 0) {
    contribution = magnitude * agreement * TASTE_PROFILE_WEIGHTS.continuumMax;
  } else {
    contribution = magnitude * agreement * TASTE_PROFILE_WEIGHTS.continuumMax * TASTE_PROFILE_WEIGHTS.mismatchRatio;
  }

  const matchLabel = contribution > 0.05
    ? `${definition.label}: ${definition.values[value]}`
    : contribution < -0.05
      ? `${definition.label}: lontano da ${definition.values[value]}`
      : null;

  return { contribution, matchLabel };
}

/**
 * Budget: fascia preferita = index+1 (€→1 … €€€€→4).
 * Curve deterministica su distanza di fasce, scalata dall'intensità.
 */
function budgetContribution(venue: Venue, value: number) {
  const definition = preferenceByKey.get('budget')!;
  if (!hasKnownVenuePricing(venue)) {
    return { contribution: 0, matchLabel: null as string | null };
  }

  const intensity = preferenceIntensity('budget', value);
  if (intensity <= 0) return { contribution: 0, matchLabel: null as string | null };

  const preferredLevel = value + 1;
  const distance = Math.abs(venue.priceLevel - preferredLevel);
  // 0→1, 1→0.48, 2→0.08, 3→-0.28, 4→-0.45
  // 0 fascia: pieno accordo; 1: vicino; 2: debole; 3–4: leggera penalità
  const affinityByDistance = [1, 0.48, 0.08, -0.32, -0.5] as const;
  const affinity = affinityByDistance[Math.min(distance, affinityByDistance.length - 1)];
  const signed = affinity >= 0
    ? affinity
    : affinity * TASTE_PROFILE_WEIGHTS.mismatchRatio;

  const contribution = intensity * signed * TASTE_PROFILE_WEIGHTS.budgetMax;
  const matchLabel = contribution > 0.05
    ? `${definition.label}: ${definition.values[value]}`
    : contribution < -0.05
      ? `${definition.label}: fuori fascia ${definition.values[value]}`
      : null;

  return { contribution, matchLabel };
}

const INTEREST_MATCHERS: Record<TasteInterest, (venue: Venue, corpus: VenueCorpus) => boolean> = {
  Rooftop: (venue, corpus) => venue.category === 'Rooftop' || termHits(corpus, ['rooftop', 'terrazza', 'tetti']) > 0,
  'Cocktail bar': (venue) => venue.category === 'Cocktail bar',
  Ristoranti: (venue) => venue.category === 'Ristorante',
  Design: (_venue, corpus) => termHits(corpus, ['design', 'architettura', 'interni curati', 'contemporaneo']) > 0
    || corpus.atmospheres.has('contemporaneo')
    || corpus.atmospheres.has('creativo'),
  Aperitivo: (venue, corpus) => venue.occasions.includes('aperitivo') || termHits(corpus, ['aperitivo', 'apericena']) > 0,
  'Vista Duomo': (venue, corpus) => termHits(corpus, ['vista duomo', 'skyline', 'duomo', 'panorama']) > 0
    || venue.features.some((feature) => normalise(feature).includes('duomo')),
  Brera: (venue) => venue.neighborhood === 'Brera',
  'Musica live': (venue, corpus) => termHits(corpus, ['musica', 'live music', 'concerto', 'dj set', 'musica live']) > 0
    || venue.features.some((feature) => normalise(feature).includes('musica')),
};

function saturateProfileScore(raw: number) {
  const { totalCap, saturationScale } = TASTE_PROFILE_WEIGHTS;
  if (raw <= 0) {
    // Soft floor: mismatch non deve affossare un locale altrimenti forte.
    const floor = -totalCap * 0.28;
    return Number(Math.max(floor, raw).toFixed(4));
  }
  const saturated = totalCap * (1 - Math.exp(-raw / saturationScale));
  return Number(Math.min(totalCap, saturated).toFixed(4));
}

/**
 * Affinità deterministica del profilo locale.
 *
 * - Solo preferenze **esplicitamente** dichiarate (chiavi assenti ≠ neutro).
 * - Intensità slider = distanza dal neutro: più spingi, più pesa.
 * - Accordo continuo con il lean del locale (non solo match binario).
 * - Leggere penalità se il locale è all'opposto dell'asse scelto.
 * - Soft-cap: raffina il ranking, non supera un match di categoria forte.
 * - Mai usato per rilassare hard constraint (valutato dopo l'eleggibilità).
 * - Mai inviato a DeepSeek: resta solo client-side.
 */
export function tasteProfileAffinity(venue: Venue, profile: TasteProfile | null | undefined): TasteProfileAffinity {
  if (!isTasteProfileActive(profile)) return { score: 0, matches: [] };

  const corpus = venueCorpus(venue);
  let raw = 0;
  const matches: string[] = [];
  const breakdown: Array<{ key: string; contribution: number }> = [];

  for (const interest of profile.interests) {
    if (!INTEREST_MATCHERS[interest](venue, corpus)) continue;
    const contribution = TASTE_PROFILE_WEIGHTS.interestHit;
    raw += contribution;
    matches.push(interest);
    breakdown.push({ key: `interest:${interest}`, contribution });
  }

  for (const [key, value] of Object.entries(profile.preferences)) {
    if (!isTastePreferenceKey(key) || !validPreferenceValue(key, value)) continue;

    if (key === 'budget') {
      const { contribution, matchLabel } = budgetContribution(venue, value);
      if (Math.abs(contribution) < 0.01) continue;
      raw += contribution;
      if (matchLabel) matches.push(matchLabel);
      breakdown.push({ key: 'budget', contribution });
      continue;
    }

    const { contribution, matchLabel } = continuumContribution(corpus, key, value);
    if (Math.abs(contribution) < 0.01) continue;
    raw += contribution;
    if (matchLabel) matches.push(matchLabel);
    breakdown.push({ key, contribution });
  }

  return {
    score: saturateProfileScore(raw),
    matches: [...new Set(matches)],
    ...(breakdown.length ? { breakdown } : {}),
  };
}

/**
 * Token semantici soft derivati dal profilo (solo client ranking).
 * Non vengono inviati al provider remoto.
 */
export function tasteProfileSemanticHints(profile: TasteProfile | null | undefined): string[] {
  if (!isTasteProfileActive(profile)) return [];

  const hints: string[] = [];

  for (const interest of profile.interests) {
    hints.push(interest);
  }

  for (const [key, value] of Object.entries(profile.preferences)) {
    if (!isTastePreferenceKey(key) || !validPreferenceValue(key, value)) continue;
    const definition = preferenceByKey.get(key);
    if (!definition || value === definition.neutralValue) continue;
    hints.push(definition.values[value]);
  }

  return [...new Set(hints.map(normalise).filter(Boolean))];
}
