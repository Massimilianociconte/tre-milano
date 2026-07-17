import type { SearchIntent, VenueCategory } from '../domain/venue';
import { NEIGHBORHOOD_NAMES } from '../domain/neighborhoods';
import type { RankingOverrides } from '../ranking/rank';
import { normaliseItalian } from '../ranking/rank';

export const SEARCH_INTERPRETATION_VERSION = 'tre-search-interpretation-v1' as const;
export const SEARCH_QUERY_MAX_CHARACTERS = 320;

export const CONTROLLED_CATEGORIES = [
  'Cocktail bar',
  'Ristorante',
  'Enoteca',
  'Rooftop',
  'Caffè',
] as const satisfies readonly VenueCategory[];

export const CONTROLLED_NEIGHBORHOODS = NEIGHBORHOOD_NAMES;

export const CONTROLLED_ATMOSPHERES = [
  'intimo',
  'elegante',
  'tranquillo',
  'romantico',
  'vivace',
  'panoramico',
  'rilassato',
  'autentico',
  'contemporaneo',
  'creativo',
  'luminoso',
  'sociale',
] as const;

export const CONTROLLED_OCCASIONS = [
  'aperitivo',
  'appuntamento',
  'cena romantica',
  'amici',
  'occasione speciale',
  'ospite fuori città',
  'brunch',
  'lavoro',
  'dopo cena',
] as const;

export const CONTROLLED_CONCEPTS = [
  'vista Duomo',
  'vista canale',
  'vista iconica',
  'spazio all’aperto',
  'conversazione',
  'vino naturale',
  'cocktail d’autore',
  'alta cucina',
  'vegetariano',
  'musica',
  'design',
  'lavorare',
  'prenotazione',
  'tramonto',
] as const;

export const UNSUPPORTED_CONSTRAINT_CODES = [
  'EXACT_OPENING_TIME',
  'DIETARY_SAFETY',
  'ACCESSIBILITY',
  'TRAVEL_ORIGIN',
] as const;

export type ControlledCategory = (typeof CONTROLLED_CATEGORIES)[number];
export type ControlledNeighborhood = (typeof CONTROLLED_NEIGHBORHOODS)[number];
export type ControlledAtmosphere = (typeof CONTROLLED_ATMOSPHERES)[number];
export type ControlledOccasion = (typeof CONTROLLED_OCCASIONS)[number];
export type ControlledConcept = (typeof CONTROLLED_CONCEPTS)[number];
export type UnsupportedConstraintCode = (typeof UNSUPPORTED_CONSTRAINT_CODES)[number];

export type IntentSignalDimension = 'category' | 'neighborhood' | 'atmosphere' | 'occasion' | 'concept';
export type IntentSignalMode = 'prefer' | 'require' | 'require_any' | 'exclude';

export type RemoteIntentSignalV1 = {
  dimension: IntentSignalDimension;
  value: string;
  mode: IntentSignalMode;
};

/**
 * Provider-neutral payload accepted from an untrusted remote interpreter.
 * It intentionally has no venue id/name, rank, score or free-form explanation.
 */
export type RemoteIntentPayloadV1 = {
  signals: RemoteIntentSignalV1[];
  minSpend: number | null;
  maxSpend: number | null;
  maxMinutes: number | null;
  requiresOpenNow: boolean;
  serviceTime: { weekday: number; minutes: number } | null;
  travelOrigin: 'none' | 'duomo' | 'unsupported';
  unsupportedConstraintCodes: UnsupportedConstraintCode[];
  semanticHints: string[];
};

export type InterpretedSearchIntentV1 = {
  categories: ControlledCategory[];
  requiredCategories: ControlledCategory[];
  excludedCategories: ControlledCategory[];
  neighborhoods: ControlledNeighborhood[];
  requiredNeighborhoods: ControlledNeighborhood[];
  excludedNeighborhoods: ControlledNeighborhood[];
  minSpend: number | null;
  maxSpend: number | null;
  maxMinutes: number | null;
  travelOriginId: 'milano-duomo-centroid' | null;
  requiresOpenNow: boolean;
  requestedServiceTime: { weekday: number; minutes: number; label: string } | null;
  atmosphere: ControlledAtmosphere[];
  requiredAtmosphere: ControlledAtmosphere[];
  requiredAtmosphereAny: ControlledAtmosphere[];
  excludedAtmosphere: ControlledAtmosphere[];
  occasions: ControlledOccasion[];
  excludedOccasions: ControlledOccasion[];
  concepts: ControlledConcept[];
  requiredConcepts: ControlledConcept[];
  excludedConcepts: ControlledConcept[];
  semanticTokens: string[];
  unsupportedConstraints: Array<{ code: UnsupportedConstraintCode; label: string }>;
};

export type SearchInterpretationFallbackReason =
  | 'not_configured'
  | 'privacy_guard'
  | 'local_sufficient'
  | 'timeout'
  | 'upstream_unavailable'
  | 'blocked'
  | 'invalid_output';

export type SearchInterpretationResponseV1 = {
  version: typeof SEARCH_INTERPRETATION_VERSION;
  source: 'deepseek' | 'deterministic-fallback';
  interpreter: {
    provider: 'deepseek';
    model: 'deepseek-v4-flash';
  };
  intent: InterpretedSearchIntentV1;
  fallbackReason?: SearchInterpretationFallbackReason;
};

export type SearchInterpretationRequestV1 = {
  version: typeof SEARCH_INTERPRETATION_VERSION;
  query: string;
};

export type SearchInterpretationErrorV1 = {
  version: typeof SEARCH_INTERPRETATION_VERSION;
  error: 'method_not_allowed' | 'forbidden_origin' | 'unsupported_media_type' | 'payload_too_large' | 'invalid_request';
};

const UNSUPPORTED_LABELS: Record<UnsupportedConstraintCode, string> = {
  EXACT_OPENING_TIME: 'apertura per giorno o orario specifico',
  DIETARY_SAFETY: 'requisiti alimentari o allergeni',
  ACCESSIBILITY: 'accessibilità verificata',
  TRAVEL_ORIGIN: 'tempi di viaggio verificati da questa origine',
};

const SIGNAL_VALUES = {
  category: CONTROLLED_CATEGORIES,
  neighborhood: CONTROLLED_NEIGHBORHOODS,
  atmosphere: CONTROLLED_ATMOSPHERES,
  occasion: CONTROLLED_OCCASIONS,
  concept: CONTROLLED_CONCEPTS,
} as const;

const SIGNAL_MODES: Record<IntentSignalDimension, readonly IntentSignalMode[]> = {
  category: ['prefer', 'require', 'exclude'],
  neighborhood: ['prefer', 'require', 'exclude'],
  atmosphere: ['prefer', 'require', 'require_any', 'exclude'],
  occasion: ['prefer', 'exclude'],
  concept: ['prefer', 'require', 'exclude'],
};

const PRIVACY_PATTERNS: RegExp[] = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?:https?:\/\/|www\.)\S+/iu,
  /\b(?:[a-z0-9-]+\.)+(?:com|it|net|org|eu|io|co)\b/iu,
  /(?:\+?\d[\s().-]*){7,}/u,
  /\b(?:codice\s+fiscale|carta\s+d['’]?identità|passaporto|password|pin\s+bancario|numero\s+di\s+carta)\b/iu,
  /\b(?:iban|conto\s+corrente|tessera\s+sanitaria|numero\s+previdenziale)\b/iu,
  /\b(?:mi\s+chiamo|il\s+mio\s+nome\s+è|a\s+nome\s+di|abito\s+(?:in|a)|il\s+mio\s+indirizzo)\b/iu,
  // A capitalized pair is conservatively kept local. This can also catch a
  // place name, but the deterministic parser remains available and avoiding
  // accidental third-party disclosure is the safer failure mode.
  /\b\p{Lu}[\p{Ll}'’-]{1,30}(?:\s+\p{Lu}[\p{Ll}'’-]{1,30}){1,2}\b/u,
  // A common given-name anchor catches ordinary lowercase full names without
  // classifying every two-word venue query as personal data.
  /\b(?:alessandra|alessandro|alessio|alice|andrea|anna|antonio|beatrice|carlo|chiara|cristina|davide|elena|elisa|emanuele|federica|federico|francesca|francesco|gabriele|giorgia|giorgio|giovanni|giulia|giuseppe|laura|leonardo|lorenzo|luca|lucia|marco|maria|mario|martina|matteo|michele|monica|nicola|paola|paolo|riccardo|roberta|roberto|sara|simona|sofia|stefano|valentina|vincenzo)\s+\p{L}[\p{L}'’-]{1,30}\b/iu,
  /\b(?:via|viale|v\.?\s*le|piazza|piazzale|p\.?\s*le|corso|c\.?\s*so|largo|vicolo|strada|str\.?|alzaia|ripa|foro|bastioni|galleria|lungomare|lungarno|contrada|localit[aà]|frazione)\s+[\p{L}'’.-]+(?:\s+[\p{L}'’.-]+){0,4}(?:\s+\d{1,4}[a-z]?)?\b/iu,
  /\b(?:diagnos|malatti|disabil|terapia|farmac|allerg|celiac|gravid|salute\s+mentale|sieropositiv|hiv|aids|tumor|cancer|carcinom|oncolog|depression|disturbo\s+bipolare|diabet|autis|epiless|scleros|alzheimer|parkinson|demen|leucem|linfom|emofil|psorias|endometrios|schizofren|anoress|bulim|genetic|biometric)\w*/iu,
  /\b(?:soffro\s+di|affett[oa]\s+da|condizione\s+medica|patologia|referto|persona\s+con)\b/iu,
  /\b(?:mia|mio|nostr[oa]|sua|suo)\s+(?:figli[oa]|minore|madre|padre|moglie|marito|partner|fidanzat[oa])\b/iu,
  /\b(?:religion|cristian|musulman|ebre|indu|buddh|ate[oa])\w*/iu,
  /\b(?:orientamento\s+sessuale|omosessual|eterosessual|bisessual|transgender|identità\s+di\s+genere)\w*/iu,
  /\b(?:partito\s+politico|voto\s+per|ideologia\s+politica|sindacat)\w*/iu,
  /\b(?:origine\s+etnica|etnia|razza)\b/iu,
];

const COMPLEX_LANGUAGE_PATTERN = /\b(?:come|sembra|sembrano|vibe|mood|atmosfera|ma|però|invece|senza|non|oppure|dove|in\s+cui|ideale|perfetto|stupire|sorprendere|ricorda|ispirato)\b/iu;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isNullableIntegerInRange(value: unknown, minimum: number, maximum: number): value is number | null {
  return value === null || isIntegerInRange(value, minimum, maximum);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function union<T>(left: readonly T[], right: readonly T[]) {
  return unique([...left, ...right]);
}

function without<T>(values: readonly T[], excluded: readonly T[]) {
  const excludedSet = new Set(excluded);
  return values.filter((value) => !excludedSet.has(value));
}

function enumIncludes<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function normalizedSemanticTokens(values: readonly string[]) {
  return unique(
    values
      .flatMap((value) => normaliseItalian(value).split(' '))
      .filter((token) => token.length >= 2 && token.length <= 32 && /^[a-z0-9€]+$/.test(token)),
  ).slice(0, 20);
}

function serviceTimeLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const minutePart = minutes % 60;
  return `alle ${String(hours).padStart(2, '0')}:${String(minutePart).padStart(2, '0')}`;
}

function controlledValues<T extends string>(values: readonly string[], allowed: readonly T[]) {
  return values.filter((value): value is T => enumIncludes(allowed, value));
}

export function hasSearchPrivacyRisk(query: string) {
  return PRIVACY_PATTERNS.some((pattern) => pattern.test(query));
}

export function validateSearchQuery(value: unknown): { ok: true; query: string } | { ok: false } {
  if (typeof value !== 'string') return { ok: false };
  const normalized = value.normalize('NFKC');
  if (/[\p{Cc}\p{Cf}]/u.test(normalized)) return { ok: false };
  const query = normalized.replace(/\s+/gu, ' ').trim();
  const length = [...query].length;
  if (length < 2 || length > SEARCH_QUERY_MAX_CHARACTERS) {
    return { ok: false };
  }
  return { ok: true, query };
}

export function shouldUseRemoteInterpretation(query: string, localIntent: SearchIntent) {
  const validated = validateSearchQuery(query);
  if (!validated.ok || hasSearchPrivacyRisk(validated.query) || localIntent.unsupportedConstraints.length) return false;

  const normalized = normaliseItalian(validated.query);
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length < 3) return false;

  const structuredSignals = localIntent.categories.length
    + localIntent.neighborhoods.length
    + localIntent.atmosphere.length
    + localIntent.occasions.length
    + localIntent.concepts.length;

  const deterministicHardSignals = Boolean(
    localIntent.minSpend !== undefined
      || localIntent.maxSpend !== undefined
      || localIntent.maxMinutes !== undefined
      || localIntent.travelOriginId
      || localIntent.requiresOpenNow
      || localIntent.requestedServiceTime
      || localIntent.requiredCategories.length
      || localIntent.excludedCategories.length
      || localIntent.requiredNeighborhoods.length
      || localIntent.excludedNeighborhoods.length
      || localIntent.requiredAtmosphere.length
      || localIntent.requiredAtmosphereAny.length
      || localIntent.excludedAtmosphere.length
      || localIntent.excludedOccasions.length
      || localIntent.requiredConcepts.length
      || localIntent.excludedConcepts.length,
  );

  // Numeric, availability and exclusion constraints are already interpreted
  // authoritatively by the local parser. Avoid paying for a remote pass when
  // the query contains no additional semantic nuance for the model to recover.
  if (structuredSignals === 0 && deterministicHardSignals && !COMPLEX_LANGUAGE_PATTERN.test(validated.query)) {
    return false;
  }

  return structuredSignals === 0 || tokens.length >= 6 || COMPLEX_LANGUAGE_PATTERN.test(validated.query);
}

export function validateRemoteIntentPayload(value: unknown): RemoteIntentPayloadV1 | null {
  const keys = [
    'signals',
    'minSpend',
    'maxSpend',
    'maxMinutes',
    'requiresOpenNow',
    'serviceTime',
    'travelOrigin',
    'unsupportedConstraintCodes',
    'semanticHints',
  ] as const;
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) return null;
  if (!Array.isArray(value.signals) || value.signals.length > 24) return null;
  if (!isNullableIntegerInRange(value.minSpend, 1, 1_000)) return null;
  if (!isNullableIntegerInRange(value.maxSpend, 1, 1_000)) return null;
  if (!isNullableIntegerInRange(value.maxMinutes, 1, 120)) return null;
  if (typeof value.requiresOpenNow !== 'boolean') return null;
  if (!enumIncludes(['none', 'duomo', 'unsupported'] as const, value.travelOrigin)) return null;
  if (!Array.isArray(value.unsupportedConstraintCodes)
    || value.unsupportedConstraintCodes.length > UNSUPPORTED_CONSTRAINT_CODES.length
    || !value.unsupportedConstraintCodes.every((code) => enumIncludes(UNSUPPORTED_CONSTRAINT_CODES, code))) return null;
  if (!Array.isArray(value.semanticHints)
    || value.semanticHints.length > 8
    || !value.semanticHints.every((hint) => typeof hint === 'string' && [...hint].length >= 2 && [...hint].length <= 48)) return null;

  let serviceTime: RemoteIntentPayloadV1['serviceTime'] = null;
  if (value.serviceTime !== null) {
    if (!isPlainRecord(value.serviceTime)
      || !hasExactKeys(value.serviceTime, ['weekday', 'minutes'])
      || !isIntegerInRange(value.serviceTime.weekday, 0, 6)
      || !isIntegerInRange(value.serviceTime.minutes, 0, 1_439)) return null;
    serviceTime = { weekday: value.serviceTime.weekday, minutes: value.serviceTime.minutes };
  }

  const signals: RemoteIntentSignalV1[] = [];
  const seenSignals = new Set<string>();
  for (const item of value.signals) {
    if (!isPlainRecord(item)
      || !hasExactKeys(item, ['dimension', 'value', 'mode'])
      || !enumIncludes(['category', 'neighborhood', 'atmosphere', 'occasion', 'concept'] as const, item.dimension)
      || !enumIncludes(['prefer', 'require', 'require_any', 'exclude'] as const, item.mode)
      || !enumIncludes(SIGNAL_VALUES[item.dimension], item.value)
      || !SIGNAL_MODES[item.dimension].includes(item.mode)) return null;
    const signature = `${item.dimension}:${item.value}`;
    if (seenSignals.has(signature)) return null;
    seenSignals.add(signature);
    signals.push({ dimension: item.dimension, value: item.value, mode: item.mode });
  }

  if (value.minSpend !== null && value.maxSpend !== null && value.minSpend > value.maxSpend) return null;

  return {
    signals,
    minSpend: value.minSpend,
    maxSpend: value.maxSpend,
    maxMinutes: value.maxMinutes,
    requiresOpenNow: value.requiresOpenNow,
    serviceTime,
    travelOrigin: value.travelOrigin,
    unsupportedConstraintCodes: unique(value.unsupportedConstraintCodes),
    semanticHints: unique(value.semanticHints.map((hint) => hint.trim())),
  };
}

function isUniqueControlledArray<T extends string>(
  value: unknown,
  allowed: readonly T[],
  maximum = allowed.length,
): value is T[] {
  return Array.isArray(value)
    && value.length <= maximum
    && value.every((item) => enumIncludes(allowed, item))
    && new Set(value).size === value.length;
}

function isSubset<T>(subset: readonly T[], superset: readonly T[]) {
  const available = new Set(superset);
  return subset.every((value) => available.has(value));
}

function isDisjoint<T>(left: readonly T[], right: readonly T[]) {
  const rightSet = new Set(right);
  return left.every((value) => !rightSet.has(value));
}

export function isInterpretedSearchIntentV1(value: unknown): value is InterpretedSearchIntentV1 {
  const keys = [
    'categories',
    'requiredCategories',
    'excludedCategories',
    'neighborhoods',
    'requiredNeighborhoods',
    'excludedNeighborhoods',
    'minSpend',
    'maxSpend',
    'maxMinutes',
    'travelOriginId',
    'requiresOpenNow',
    'requestedServiceTime',
    'atmosphere',
    'requiredAtmosphere',
    'requiredAtmosphereAny',
    'excludedAtmosphere',
    'occasions',
    'excludedOccasions',
    'concepts',
    'requiredConcepts',
    'excludedConcepts',
    'semanticTokens',
    'unsupportedConstraints',
  ] as const;
  if (!isPlainRecord(value) || !hasExactKeys(value, keys)) return false;
  if (!isUniqueControlledArray(value.categories, CONTROLLED_CATEGORIES)
    || !isUniqueControlledArray(value.requiredCategories, CONTROLLED_CATEGORIES)
    || !isUniqueControlledArray(value.excludedCategories, CONTROLLED_CATEGORIES)
    || !isSubset(value.requiredCategories, value.categories)
    || !isDisjoint(value.categories, value.excludedCategories)) return false;
  if (!isUniqueControlledArray(value.neighborhoods, CONTROLLED_NEIGHBORHOODS)
    || !isUniqueControlledArray(value.requiredNeighborhoods, CONTROLLED_NEIGHBORHOODS)
    || !isUniqueControlledArray(value.excludedNeighborhoods, CONTROLLED_NEIGHBORHOODS)
    || !isSubset(value.requiredNeighborhoods, value.neighborhoods)
    || !isDisjoint(value.neighborhoods, value.excludedNeighborhoods)) return false;
  if (!isNullableIntegerInRange(value.minSpend, 1, 1_000)
    || !isNullableIntegerInRange(value.maxSpend, 1, 1_000)
    || !isNullableIntegerInRange(value.maxMinutes, 1, 120)
    || (value.minSpend !== null && value.maxSpend !== null && value.minSpend > value.maxSpend)) return false;
  if (value.travelOriginId !== null && value.travelOriginId !== 'milano-duomo-centroid') return false;
  if (typeof value.requiresOpenNow !== 'boolean') return false;
  if (value.requestedServiceTime !== null) {
    if (!isPlainRecord(value.requestedServiceTime)
      || !hasExactKeys(value.requestedServiceTime, ['weekday', 'minutes', 'label'])
      || !isIntegerInRange(value.requestedServiceTime.weekday, 0, 6)
      || !isIntegerInRange(value.requestedServiceTime.minutes, 0, 1_439)
      || value.requestedServiceTime.label !== serviceTimeLabel(value.requestedServiceTime.minutes)) return false;
  }
  if (!isUniqueControlledArray(value.atmosphere, CONTROLLED_ATMOSPHERES)
    || !isUniqueControlledArray(value.requiredAtmosphere, CONTROLLED_ATMOSPHERES)
    || !isUniqueControlledArray(value.requiredAtmosphereAny, CONTROLLED_ATMOSPHERES)
    || !isUniqueControlledArray(value.excludedAtmosphere, CONTROLLED_ATMOSPHERES)
    || !isSubset(value.requiredAtmosphere, value.atmosphere)
    || !isSubset(value.requiredAtmosphereAny, value.atmosphere)
    || !isDisjoint(value.atmosphere, value.excludedAtmosphere)) return false;
  if (!isUniqueControlledArray(value.occasions, CONTROLLED_OCCASIONS)
    || !isUniqueControlledArray(value.excludedOccasions, CONTROLLED_OCCASIONS)
    || !isDisjoint(value.occasions, value.excludedOccasions)) return false;
  if (!isUniqueControlledArray(value.concepts, CONTROLLED_CONCEPTS)
    || !isUniqueControlledArray(value.requiredConcepts, CONTROLLED_CONCEPTS)
    || !isUniqueControlledArray(value.excludedConcepts, CONTROLLED_CONCEPTS)
    || !isSubset(value.requiredConcepts, value.concepts)
    || !isDisjoint(value.concepts, value.excludedConcepts)) return false;
  if (!Array.isArray(value.semanticTokens)
    || value.semanticTokens.length > 20
    || new Set(value.semanticTokens).size !== value.semanticTokens.length
    || !value.semanticTokens.every((token) => typeof token === 'string' && /^[a-z0-9€]{2,32}$/.test(token))) return false;
  if (!Array.isArray(value.unsupportedConstraints)
    || value.unsupportedConstraints.length > UNSUPPORTED_CONSTRAINT_CODES.length) return false;
  const unsupportedCodes = new Set<string>();
  for (const constraint of value.unsupportedConstraints) {
    if (!isPlainRecord(constraint)
      || !hasExactKeys(constraint, ['code', 'label'])
      || !enumIncludes(UNSUPPORTED_CONSTRAINT_CODES, constraint.code)
      || typeof constraint.label !== 'string'
      || !constraint.label.trim()
      || [...constraint.label].length > 120
      || unsupportedCodes.has(constraint.code)) return false;
    unsupportedCodes.add(constraint.code);
  }
  return true;
}

export function isSearchInterpretationResponseV1(value: unknown): value is SearchInterpretationResponseV1 {
  if (!isPlainRecord(value)) return false;
  const source = value.source;
  const expectedKeys = source === 'deterministic-fallback'
    ? ['version', 'source', 'interpreter', 'intent', 'fallbackReason']
    : ['version', 'source', 'interpreter', 'intent'];
  if (!hasExactKeys(value, expectedKeys)
    || value.version !== SEARCH_INTERPRETATION_VERSION
    || (source !== 'deepseek' && source !== 'deterministic-fallback')
    || !isPlainRecord(value.interpreter)
    || !hasExactKeys(value.interpreter, ['provider', 'model'])
    || value.interpreter.provider !== 'deepseek'
    || value.interpreter.model !== 'deepseek-v4-flash'
    || !isInterpretedSearchIntentV1(value.intent)) return false;
  if (source === 'deepseek') return value.fallbackReason === undefined;
  return enumIncludes(
    ['not_configured', 'privacy_guard', 'local_sufficient', 'timeout', 'upstream_unavailable', 'blocked', 'invalid_output'] as const,
    value.fallbackReason,
  );
}

export function interpretationFromLocalIntent(intent: SearchIntent): InterpretedSearchIntentV1 {
  const unsupportedConstraints = intent.unsupportedConstraints
    .filter(({ code }) => enumIncludes(UNSUPPORTED_CONSTRAINT_CODES, code))
    .map(({ code, label }) => ({ code: code as UnsupportedConstraintCode, label }));

  return {
    categories: controlledValues(intent.categories, CONTROLLED_CATEGORIES),
    requiredCategories: controlledValues(intent.requiredCategories, CONTROLLED_CATEGORIES),
    excludedCategories: controlledValues(intent.excludedCategories, CONTROLLED_CATEGORIES),
    neighborhoods: controlledValues(intent.neighborhoods, CONTROLLED_NEIGHBORHOODS),
    requiredNeighborhoods: controlledValues(intent.requiredNeighborhoods, CONTROLLED_NEIGHBORHOODS),
    excludedNeighborhoods: controlledValues(intent.excludedNeighborhoods, CONTROLLED_NEIGHBORHOODS),
    minSpend: intent.minSpend ?? null,
    maxSpend: intent.maxSpend ?? null,
    maxMinutes: intent.maxMinutes ?? null,
    travelOriginId: intent.travelOriginId === 'milano-duomo-centroid' ? intent.travelOriginId : null,
    requiresOpenNow: intent.requiresOpenNow,
    requestedServiceTime: intent.requestedServiceTime ?? null,
    atmosphere: controlledValues(intent.atmosphere, CONTROLLED_ATMOSPHERES),
    requiredAtmosphere: controlledValues(intent.requiredAtmosphere, CONTROLLED_ATMOSPHERES),
    requiredAtmosphereAny: controlledValues(intent.requiredAtmosphereAny, CONTROLLED_ATMOSPHERES),
    excludedAtmosphere: controlledValues(intent.excludedAtmosphere, CONTROLLED_ATMOSPHERES),
    occasions: controlledValues(intent.occasions, CONTROLLED_OCCASIONS),
    excludedOccasions: controlledValues(intent.excludedOccasions, CONTROLLED_OCCASIONS),
    concepts: controlledValues(intent.concepts, CONTROLLED_CONCEPTS),
    requiredConcepts: controlledValues(intent.requiredConcepts, CONTROLLED_CONCEPTS),
    excludedConcepts: controlledValues(intent.excludedConcepts, CONTROLLED_CONCEPTS),
    semanticTokens: normalizedSemanticTokens(intent.semanticTokens),
    unsupportedConstraints,
  };
}

function signalsFor<T extends string>(
  payload: RemoteIntentPayloadV1,
  dimension: IntentSignalDimension,
  allowed: readonly T[],
  modes: readonly IntentSignalMode[],
) {
  return payload.signals
    .filter((signal) => signal.dimension === dimension && modes.includes(signal.mode))
    .map((signal) => signal.value)
    .filter((value): value is T => enumIncludes(allowed, value));
}

const REMOTE_SPEND_CUE = /(?:€|\beuro\b|\bbudget\b|\bspend\w*\b|\bcost\w*\b|\bprezz\w*\b)/;
const REMOTE_WALKING_CUE = /(?:\bminut\w*\b|\ba piedi\b|\bcammin\w*\b|\bmezz ora\b|\bquarto d ora\b)/;
const REMOTE_OPEN_NOW_CUE = /(?:\bapert[oaie]\b|\bora\b|\badesso\b|\bin questo momento\b)/;
const REMOTE_OPEN_NOW_NEGATION = /(?:\bnon\b|\bsenza\b)(?:\s+\w+){0,3}\s+(?:apert[oaie]|ora|adesso)\b/;
const REMOTE_EXPLICIT_TIME_CUE = /\b(?:alle|per le|verso le|intorno alle)\s+(?:\d{1,2}(?:\s+\d{2})?|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici|tredici|quattordici|quindici|sedici|diciassette|diciotto|diciannove|venti|ventuno|ventidue|ventitre)(?:\s+e\s+(?:mezza|un quarto))?\b/;

/**
 * Remote output can enrich the local parse, but never remove or weaken a
 * locally found hard requirement/exclusion. Validated scalar constraints may
 * fill a missing local value only when the original query contains explicit
 * supporting language; vague model guesses remain ignored.
 */
export function reconcileRemoteIntent(
  localIntent: SearchIntent,
  remote: RemoteIntentPayloadV1,
): InterpretedSearchIntentV1 {
  const local = interpretationFromLocalIntent(localIntent);

  const remoteRequiredCategories = signalsFor(remote, 'category', CONTROLLED_CATEGORIES, ['require']);
  const remoteExcludedCategories = signalsFor(remote, 'category', CONTROLLED_CATEGORIES, ['exclude']);
  let requiredCategories = union(local.requiredCategories, remoteRequiredCategories);
  let excludedCategories = union(local.excludedCategories, remoteExcludedCategories);
  excludedCategories = without(excludedCategories, local.requiredCategories);
  requiredCategories = without(requiredCategories, local.excludedCategories);
  let categories = union(local.categories, signalsFor(remote, 'category', CONTROLLED_CATEGORIES, ['prefer', 'require']));
  categories = union(without(categories, excludedCategories), requiredCategories);

  const remoteRequiredNeighborhoods = signalsFor(remote, 'neighborhood', CONTROLLED_NEIGHBORHOODS, ['require']);
  const remoteExcludedNeighborhoods = signalsFor(remote, 'neighborhood', CONTROLLED_NEIGHBORHOODS, ['exclude']);
  let requiredNeighborhoods = union(local.requiredNeighborhoods, remoteRequiredNeighborhoods);
  let excludedNeighborhoods = union(local.excludedNeighborhoods, remoteExcludedNeighborhoods);
  excludedNeighborhoods = without(excludedNeighborhoods, local.requiredNeighborhoods);
  requiredNeighborhoods = without(requiredNeighborhoods, local.excludedNeighborhoods);
  let neighborhoods = union(local.neighborhoods, signalsFor(remote, 'neighborhood', CONTROLLED_NEIGHBORHOODS, ['prefer', 'require']));
  neighborhoods = union(without(neighborhoods, excludedNeighborhoods), requiredNeighborhoods);

  const remoteRequiredAtmosphere = signalsFor(remote, 'atmosphere', CONTROLLED_ATMOSPHERES, ['require']);
  const remoteRequiredAtmosphereAny = signalsFor(remote, 'atmosphere', CONTROLLED_ATMOSPHERES, ['require_any']);
  const remoteExcludedAtmosphere = signalsFor(remote, 'atmosphere', CONTROLLED_ATMOSPHERES, ['exclude']);
  let requiredAtmosphere = union(local.requiredAtmosphere, remoteRequiredAtmosphere);
  let requiredAtmosphereAny = union(local.requiredAtmosphereAny, remoteRequiredAtmosphereAny);
  let excludedAtmosphere = union(local.excludedAtmosphere, remoteExcludedAtmosphere);
  excludedAtmosphere = without(excludedAtmosphere, [...local.requiredAtmosphere, ...local.requiredAtmosphereAny]);
  requiredAtmosphere = without(requiredAtmosphere, local.excludedAtmosphere);
  requiredAtmosphereAny = without(requiredAtmosphereAny, local.excludedAtmosphere);
  let atmosphere = union(local.atmosphere, signalsFor(remote, 'atmosphere', CONTROLLED_ATMOSPHERES, ['prefer', 'require', 'require_any']));
  atmosphere = union(without(atmosphere, excludedAtmosphere), [...requiredAtmosphere, ...requiredAtmosphereAny]);

  let excludedOccasions = union(local.excludedOccasions, signalsFor(remote, 'occasion', CONTROLLED_OCCASIONS, ['exclude']));
  let occasions = union(local.occasions, signalsFor(remote, 'occasion', CONTROLLED_OCCASIONS, ['prefer']));
  occasions = without(occasions, excludedOccasions);

  const remoteRequiredConcepts = signalsFor(remote, 'concept', CONTROLLED_CONCEPTS, ['require']);
  const remoteExcludedConcepts = signalsFor(remote, 'concept', CONTROLLED_CONCEPTS, ['exclude']);
  let requiredConcepts = union(local.requiredConcepts, remoteRequiredConcepts);
  let excludedConcepts = union(local.excludedConcepts, remoteExcludedConcepts);
  excludedConcepts = without(excludedConcepts, local.requiredConcepts);
  requiredConcepts = without(requiredConcepts, local.excludedConcepts);
  let concepts = union(local.concepts, signalsFor(remote, 'concept', CONTROLLED_CONCEPTS, ['prefer', 'require']));
  concepts = union(without(concepts, excludedConcepts), requiredConcepts);

  const remoteUnsupportedCodes = [...remote.unsupportedConstraintCodes];
  if (remote.travelOrigin === 'unsupported') remoteUnsupportedCodes.push('TRAVEL_ORIGIN');
  const unsupportedCodes = union(local.unsupportedConstraints.map(({ code }) => code), remoteUnsupportedCodes);
  const normalizedQuery = normaliseItalian(localIntent.query);
  const hasSpendCue = REMOTE_SPEND_CUE.test(normalizedQuery);
  const remoteMinSpend = hasSpendCue ? remote.minSpend : null;
  const remoteMaxSpend = hasSpendCue ? remote.maxSpend : null;
  let minSpend = local.minSpend ?? remoteMinSpend;
  let maxSpend = local.maxSpend ?? remoteMaxSpend;
  if (minSpend !== null && maxSpend !== null && minSpend > maxSpend) {
    if (local.minSpend !== null) maxSpend = local.maxSpend;
    else if (local.maxSpend !== null) minSpend = local.minSpend;
    else {
      minSpend = null;
      maxSpend = null;
    }
  }
  const maxMinutes = local.maxMinutes
    ?? (REMOTE_WALKING_CUE.test(normalizedQuery) ? remote.maxMinutes : null);
  const requiresOpenNow = local.requiresOpenNow || Boolean(
    remote.requiresOpenNow
      && REMOTE_OPEN_NOW_CUE.test(normalizedQuery)
      && !REMOTE_OPEN_NOW_NEGATION.test(normalizedQuery),
  );
  const requestedServiceTime = local.requestedServiceTime ?? (
    remote.serviceTime && REMOTE_EXPLICIT_TIME_CUE.test(normalizedQuery)
      ? { ...remote.serviceTime, label: serviceTimeLabel(remote.serviceTime.minutes) }
      : null
  );
  const travelOriginId = local.travelOriginId ?? (
    remote.travelOrigin === 'duomo' && /\bduomo\b/.test(normalizedQuery)
      ? 'milano-duomo-centroid'
      : null
  );

  return {
    categories,
    requiredCategories,
    excludedCategories,
    neighborhoods,
    requiredNeighborhoods,
    excludedNeighborhoods,
    minSpend,
    maxSpend,
    maxMinutes,
    travelOriginId,
    requiresOpenNow,
    requestedServiceTime,
    atmosphere,
    requiredAtmosphere,
    requiredAtmosphereAny,
    excludedAtmosphere,
    occasions,
    excludedOccasions,
    concepts,
    requiredConcepts,
    excludedConcepts,
    semanticTokens: normalizedSemanticTokens([...local.semanticTokens, ...remote.semanticHints]),
    unsupportedConstraints: unsupportedCodes.map((code) => ({
      code,
      label: local.unsupportedConstraints.find((constraint) => constraint.code === code)?.label ?? UNSUPPORTED_LABELS[code],
    })),
  };
}

export function interpretationToRankingOverrides(intent: InterpretedSearchIntentV1): RankingOverrides {
  return {
    category: intent.categories[0],
    categories: intent.categories,
    requiredCategories: intent.requiredCategories,
    excludedCategories: intent.excludedCategories,
    neighborhood: intent.neighborhoods[0],
    neighborhoods: intent.neighborhoods,
    requiredNeighborhoods: intent.requiredNeighborhoods,
    excludedNeighborhoods: intent.excludedNeighborhoods,
    minSpend: intent.minSpend ?? undefined,
    maxSpend: intent.maxSpend ?? undefined,
    maxMinutes: intent.maxMinutes ?? undefined,
    travelOriginId: intent.travelOriginId ?? undefined,
    requiresOpenNow: intent.requiresOpenNow,
    requestedServiceTime: intent.requestedServiceTime ?? undefined,
    atmosphere: intent.atmosphere,
    requiredAtmosphere: intent.requiredAtmosphere,
    requiredAtmosphereAny: intent.requiredAtmosphereAny,
    excludedAtmosphere: intent.excludedAtmosphere,
    occasion: intent.occasions[0],
    occasions: intent.occasions,
    excludedOccasions: intent.excludedOccasions,
    concepts: intent.concepts,
    requiredConcepts: intent.requiredConcepts,
    excludedConcepts: intent.excludedConcepts,
    semanticTokens: intent.semanticTokens,
    unsupportedConstraints: intent.unsupportedConstraints,
  };
}
