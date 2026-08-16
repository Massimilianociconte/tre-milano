import { venues as defaultVenues } from '../data/venues';
import { NEIGHBORHOOD_LEXICON, type NeighborhoodName } from '../domain/neighborhoods';
import { type TasteProfile, tasteProfileAffinity } from '../domain/taste-profile';
import type {
  RankedVenue,
  RankingReasonCode,
  SearchIntent,
  SessionTravelEstimate,
  Venue,
  VenueCategory,
} from '../domain/venue';
import {
  hasKnownVenuePricing,
  hasUsableOpenStatus,
  isVenueAvailableAt,
  isVenueRankingEligible,
} from '../domain/venue';
import { CONCEPT_WEIGHTS, RANKING_THRESHOLDS, RANKING_WEIGHTS } from './config';

export type RankingContext = {
  /** Detached, ephemeral estimates keyed by venue id; never copied into Gold provenance. */
  sessionTravelEstimates?: Readonly<Record<string, SessionTravelEstimate>>;
};

function sessionEstimateFor(venue: Venue, context?: RankingContext) {
  return context?.sessionTravelEstimates?.[venue.id];
}

function effectiveTravelMinutes(venue: Venue, context?: RankingContext) {
  return sessionEstimateFor(venue, context)?.minutes ?? venue.travelEstimate.minutes;
}

/**
 * The retriever is deliberately local and deterministic. It only indexes
 * curated fields already present on a Gold-eligible venue and never invents
 * facts, calls a model or relaxes an explicit exclusion.
 */
export const normaliseItalian = (value: string) =>
  value
    .toLocaleLowerCase('it-IT')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9€]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type LexiconEntry<T extends string> = {
  value: T;
  aliases: string[];
};

const CATEGORY_LEXICON: Array<LexiconEntry<VenueCategory>> = [
  {
    value: 'Cocktail bar',
    aliases: ['cocktail bar', 'cocktail', 'drink', 'speakeasy', 'mixology', 'miscelazione'],
  },
  {
    value: 'Ristorante',
    aliases: ['ristorante', 'ristoranti', 'cena', 'cenare', 'trattoria', 'bistrot', 'fine dining', 'degustazione'],
  },
  {
    value: 'Enoteca',
    aliases: ['enoteca', 'enoteche', 'vino', 'vini', 'wine bar', 'bottiglieria'],
  },
  {
    value: 'Rooftop',
    aliases: ['rooftop', 'rooftop bar', 'terrazza', 'terrazze', 'locale sui tetti'],
  },
  {
    value: 'Caffè',
    aliases: ['caffe', 'caffetteria', 'coffee shop', 'brunch', 'colazione', 'pasticceria'],
  },
];

const NEIGHBORHOOD_ENTRIES: Array<LexiconEntry<NeighborhoodName>> = NEIGHBORHOOD_LEXICON.map(
  (entry) => ({ value: entry.value, aliases: [...entry.aliases] }),
);

const ATMOSPHERE_LEXICON: Array<LexiconEntry<string>> = [
  { value: 'intimo', aliases: ['intimo', 'intima', 'raccolto', 'riservato', 'privacy'] },
  { value: 'elegante', aliases: ['elegante', 'raffinato', 'raffinata', 'chic', 'sofisticato'] },
  { value: 'tranquillo', aliases: ['tranquillo', 'tranquilla', 'calmo', 'quieto', 'poco rumoroso'] },
  { value: 'romantico', aliases: ['romantico', 'romantica', 'romance'] },
  {
    value: 'vivace',
    aliases: [
      'vivace',
      'animato',
      'movimentato',
      'energia',
      'energetico',
      'rumoroso',
      'rumorosa',
      'chiassoso',
      'chiassosa',
      'musica vivace',
      'musica rumorosa',
    ],
  },
  { value: 'panoramico', aliases: ['panoramico', 'panoramica', 'skyline', 'vista'] },
  { value: 'rilassato', aliases: ['rilassato', 'rilassata', 'informale', 'easy', 'senza fretta'] },
  { value: 'autentico', aliases: ['autentico', 'autentica', 'milanese vero'] },
  { value: 'contemporaneo', aliases: ['contemporaneo', 'moderno', 'moderna', 'trendy'] },
  {
    value: 'creativo',
    aliases: [
      'creativo',
      'creativa',
      'originale',
      'ricercato',
      'scenografico',
      'scenografica',
      'cinematografico',
      'cinematografica',
      'teatrale',
      'instagrammabile',
    ],
  },
  { value: 'luminoso', aliases: ['luminoso', 'luminosa', 'luce naturale'] },
  { value: 'sociale', aliases: ['sociale', 'conviviale', 'socievole', 'per socializzare'] },
];

const OCCASION_LEXICON: Array<LexiconEntry<string>> = [
  {
    value: 'aperitivo',
    aliases: ['aperitivo', 'apericena', 'happy hour', 'dopo lavoro', 'after work', 'afterwork'],
  },
  {
    value: 'appuntamento',
    aliases: ['appuntamento', 'primo appuntamento', 'date', 'date night', 'serata a due'],
  },
  {
    value: 'cena romantica',
    aliases: ['cena romantica', 'serata romantica', 'cenetta', 'romantico per due'],
  },
  {
    value: 'amici',
    aliases: ['amici', 'gruppo', 'gruppi', 'compagnia', 'rimpatriata'],
  },
  {
    value: 'occasione speciale',
    aliases: ['occasione speciale', 'anniversario', 'compleanno', 'festeggiare', 'celebrazione'],
  },
  {
    value: 'ospite fuori città',
    aliases: ['ospite fuori citta', 'turista', 'visitatori', 'far vedere milano', 'prima volta a milano'],
  },
  { value: 'brunch', aliases: ['brunch', 'colazione lunga', 'pranzo tardi'] },
  { value: 'lavoro', aliases: ['lavoro', 'business', 'cliente', 'colleghi', 'riunione', 'laptop'] },
  { value: 'dopo cena', aliases: ['dopo cena', 'dopocena', 'late night', 'notte'] },
];

type ConceptEntry = LexiconEntry<string>;

const CONCEPT_LEXICON: ConceptEntry[] = [
  {
    value: 'vista Duomo',
    aliases: ['vista duomo', 'vista sul duomo', 'duomo in vista'],
  },
  {
    value: 'vista canale',
    aliases: ['vista canale', 'affaccio sul canale', 'vista naviglio'],
  },
  {
    value: 'vista iconica',
    aliases: ['vista sulla citta', 'skyline', 'panorama', 'panoramico'],
  },
  {
    value: 'spazio all’aperto',
    aliases: ['all aperto', 'tavoli fuori', 'dehors', 'terrazza', 'giardino', 'patio'],
  },
  {
    value: 'conversazione',
    aliases: ['parlare', 'conversare', 'conversazione', 'locale silenzioso', 'senza musica alta', 'poco rumore'],
  },
  {
    value: 'vino naturale',
    aliases: ['vino naturale', 'vini naturali', 'orange wine', 'piccoli produttori'],
  },
  {
    value: 'cocktail d’autore',
    aliases: ['cocktail d autore', 'mixology', 'miscelazione', 'signature cocktail', 'drink ricercati'],
  },
  {
    value: 'alta cucina',
    aliases: ['alta cucina', 'fine dining', 'degustazione', 'menu degustazione', 'servizio curato'],
  },
  {
    value: 'vegetariano',
    aliases: ['vegetariano', 'vegetariana', 'vegetariane', 'veg', 'cucina vegetale'],
  },
  {
    value: 'opzioni vegane',
    aliases: ['opzioni vegane', 'opzione vegana', 'vegano', 'vegana', 'plant based'],
  },
  {
    value: 'musica',
    aliases: ['musica', 'dj', 'dj set', 'live music', 'concerto'],
  },
  {
    value: 'design',
    aliases: ['design', 'architettura', 'interni curati', 'instagrammabile'],
  },
  {
    value: 'lavorare',
    aliases: ['lavorare al computer', 'laptop friendly', 'wifi', 'presa elettrica', 'smart working'],
  },
  {
    value: 'prenotazione',
    aliases: ['prenotazione', 'prenotabile', 'prenotare', 'riservare'],
  },
  { value: 'asporto', aliases: ['asporto', 'take away', 'takeaway'] },
  { value: 'consegna', aliases: ['consegna', 'delivery', 'consegna a domicilio'] },
  { value: 'wifi', aliases: ['wifi', 'wi fi', 'internet'] },
  { value: 'pet friendly', aliases: ['pet friendly', 'animali ammessi', 'cani ammessi'] },
  { value: 'parcheggio', aliases: ['parcheggio', 'parking'] },
  { value: 'eventi privati', aliases: ['eventi privati', 'evento privato', 'festa privata', 'sala privata'] },
  {
    value: 'tramonto',
    aliases: ['tramonto', 'golden hour', 'ora dorata'],
  },
];

const STOP_WORDS = new Set([
  'a',
  'ad',
  'al',
  'alla',
  'anche',
  'che',
  'con',
  'da',
  'dei',
  'del',
  'della',
  'di',
  'e',
  'gli',
  'il',
  'in',
  'io',
  'la',
  'le',
  'lo',
  'locale',
  'locali',
  'mi',
  'nei',
  'nel',
  'o',
  'per',
  'posto',
  'posti',
  'qualcosa',
  'sono',
  'su',
  'tra',
  'un',
  'una',
  'uno',
  'vorrei',
  'voglio',
  'cerco',
]);

const PARTY_SIZE_WORDS = Object.freeze({
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
  undici: 11,
  dodici: 12,
  tredici: 13,
  quattordici: 14,
  quindici: 15,
  sedici: 16,
  diciassette: 17,
  diciotto: 18,
  diciannove: 19,
  venti: 20,
});
const PARTY_SIZE_WORD_PATTERN = Object.keys(PARTY_SIZE_WORDS).join('|');

const unique = <T>(items: T[]) => [...new Set(items)];
const CLAUSE_BREAK = 'clausebreak';
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phrasePattern = (phrase: string) => escapeRegExp(normaliseItalian(phrase)).replace(/\s+/g, '\\s+');
const containsPhrase = (text: string, phrase: string) =>
  new RegExp(`(?:^|\\s)${phrasePattern(phrase)}(?=\\s|$)`).test(text);

const NEGATION_PREFIX =
  '(?:senza|niente|no|escludi|escludere|evita|evitare|tranne|non(?:\\s+(?:voglio|vorrei|cerco|desidero|gradisco|amo|mi\\s+piace|mi\\s+interessa|deve\\s+essere|deve\\s+avere|deve\\s+esserci|ci\\s+sia))?)';
const OPTIONAL_PREFIX =
  '(?:non\\s+(?:necessariamente|per\\s+forza)|non\\s+e\\s+necessari[oa](?:\\s+che\\s+(?:sia|abbia))?|non\\s+serve(?:\\s+che\\s+(?:sia|abbia))?|non\\s+deve\\s+per\\s+forza(?:\\s+(?:essere|avere))?)';

function isOptional(text: string, alias: string) {
  const bridgeWord = '(?:un|una|uno|il|lo|la|i|gli|le|a|al|allo|alla|ai|agli|alle|in|di|da|con|che|sia|abbia|essere|avere|posto|locale|zona|quartiere)';
  const boundedBridge = `(?:${bridgeWord}\\s+){0,5}`;
  const coordinated = `(?:^|\\s)${OPTIONAL_PREFIX}\\s+(?:(?!${CLAUSE_BREAK}\\b)[a-z0-9€]+\\s+){0,6}(?:e|o|oppure)\\s+${boundedBridge}${phrasePattern(alias)}(?=\\s|$)`;
  return new RegExp(`(?:^|\\s)${OPTIONAL_PREFIX}\\s+${boundedBridge}${phrasePattern(alias)}(?=\\s|$)`).test(text)
    || new RegExp(coordinated).test(text);
}

function isNegated(text: string, alias: string) {
  const bridgeWord = '(?:un|una|uno|il|lo|la|i|gli|le|dei|delle|degli|a|al|allo|alla|ai|agli|alle|in|di|da|con|che|sia|abbia|essere|avere|andare|finire|stare|posto|posti|locale|locali|troppo|molto|zona|quartiere|per\\s+forza)';
  const boundedBridge = `(?:${bridgeWord}\\s+){0,6}`;
  const coordinatedList = `(?:^|\\s)${NEGATION_PREFIX}\\s+(?:(?!${CLAUSE_BREAK}\\b)[a-z0-9€]+\\s+){0,6}(?:e|ne|o|oppure)\\s+(?:(?:un|una|uno|il|lo|la|i|gli|le|a|al|alla|ai)\\s+)?${phrasePattern(alias)}(?=\\s|$)`;
  return new RegExp(`(?:^|\\s)${NEGATION_PREFIX}\\s+${boundedBridge}${phrasePattern(alias)}(?=\\s|$)`).test(text) ||
    new RegExp(`(?:^|\\s)tutto\\s+tranne\\s+${boundedBridge}${phrasePattern(alias)}(?=\\s|$)`).test(text) ||
    new RegExp(coordinatedList).test(text);
}

function isRequired(text: string, alias: string) {
  if (new RegExp(`(?:^|\\s)${phrasePattern(alias)}\\s+(?:obbligatori[oaie]|necessari[oaie])(?=\\s|$)`).test(text)) {
    return true;
  }
  const aliasIndex = text.search(new RegExp(`(?:^|\\s)${phrasePattern(alias)}(?=\\s|$)`));
  if (aliasIndex < 0) return false;

  const prefixPattern = /(?:^|\s)(?:solo|soltanto|esclusivamente|obbligatoriamente|deve\s+essere|deve\s+avere|necessariamente)(?=\s)/g;
  let latestPrefixEnd = -1;
  for (const match of text.matchAll(prefixPattern)) {
    if ((match.index ?? 0) >= aliasIndex) break;
    latestPrefixEnd = (match.index ?? 0) + match[0].length;
  }
  if (latestPrefixEnd < 0) return false;

  const scope = text.slice(latestPrefixEnd, aliasIndex).trim();
  if (scope.includes(CLAUSE_BREAK) || scope.split(/\s+/).length > 10) return false;
  if (!scope || /^(?:(?:un|una|uno|il|lo|la|i|gli|le|con|in|di|a|al|allo|alla|ai|agli|alle|qualcosa|posto|locale|che|sia|essere|zona|quartiere)\s*)+$/.test(scope)) return true;
  return /(?:^|\s)(?:e|o|ne|oppure|ma\s+anche)(?=\s|$)/.test(scope);
}

function findLexiconMatches<T extends string>(text: string, lexicon: Array<LexiconEntry<T>>) {
  const positive: Array<{ value: T; index: number }> = [];
  const excluded: Array<{ value: T; index: number }> = [];
  const required: Array<{ value: T; index: number }> = [];
  const optional: Array<{ value: T; index: number }> = [];

  for (const entry of lexicon) {
    const occurrences = entry.aliases
      .map((alias) => ({ alias, index: text.search(new RegExp(`(?:^|\\s)${phrasePattern(alias)}(?=\\s|$)`)) }))
      .filter(({ index }) => index >= 0)
      .sort((a, b) => a.index - b.index);
    if (!occurrences.length) continue;

    const optionalOccurrence = occurrences.find(({ alias }) => isOptional(text, alias));
    const negativeOccurrence = occurrences.find(({ alias }) => !isOptional(text, alias) && isNegated(text, alias));
    const positiveOccurrence = occurrences.find(({ alias }) => !isOptional(text, alias) && !isNegated(text, alias));
    const requiredOccurrence = occurrences.find(({ alias }) => !isOptional(text, alias) && !isNegated(text, alias) && isRequired(text, alias));
    if (optionalOccurrence) optional.push({ value: entry.value, index: optionalOccurrence.index });
    if (negativeOccurrence) excluded.push({ value: entry.value, index: negativeOccurrence.index });
    if (positiveOccurrence) positive.push({ value: entry.value, index: positiveOccurrence.index });
    if (requiredOccurrence) required.push({ value: entry.value, index: requiredOccurrence.index });
  }

  const ordered = (matches: Array<{ value: T; index: number }>) =>
    unique(matches.sort((a, b) => a.index - b.index).map(({ value }) => value));

  const excludedValues = ordered(excluded);
  return {
    // An explicit negative phrase wins when a longer negated alias overlaps a
    // shorter positive alias (for example "senza musica vivace").
    positive: ordered(positive).filter((value) => !excludedValues.includes(value)),
    excluded: excludedValues,
    required: ordered(required),
    optional: ordered(optional),
  };
}

function stemItalian(token: string) {
  if (token.length <= 4 || /\d/.test(token)) return token;
  return token
    .replace(/(?:amente|imento|imenti|azione|azioni|mente)$/u, '')
    .replace(/(?:ando|endo|are|ere|ire)$/u, '')
    .replace(/[aeio]$/u, '');
}

function semanticTokens(value: string) {
  return unique(
    normaliseItalian(value)
      .split(' ')
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token))
      .map(stemItalian)
      .filter((token) => token.length > 2),
  );
}

function canonicalSelectedOccasion(selectedOccasion?: string) {
  if (!selectedOccasion) return undefined;
  const text = normaliseItalian(selectedOccasion);
  return findLexiconMatches(text, OCCASION_LEXICON).positive[0] || text;
}

function lexiconTokensForValues<T extends string>(values: T[], lexicon: Array<LexiconEntry<T>>) {
  return new Set(
    lexicon
      .filter((entry) => values.includes(entry.value))
      .flatMap((entry) => [entry.value, ...entry.aliases])
      .flatMap(semanticTokens),
  );
}

function requiredValuesUseAlternative<T extends string>(
  text: string,
  values: T[],
  lexicon: Array<LexiconEntry<T>>,
) {
  const firstValueIndex = Math.min(
    ...lexicon
      .filter((entry) => values.includes(entry.value))
      .flatMap((entry) => entry.aliases.map((alias) => text.search(new RegExp(`(?:^|\\s)${phrasePattern(alias)}(?=\\s|$)`))))
      .filter((index) => index >= 0),
  );
  if (!Number.isFinite(firstValueIndex)) return false;

  const prefixPattern = /(?:^|\s)(?:solo|soltanto|esclusivamente|obbligatoriamente|deve\s+essere|deve\s+avere|necessariamente)(?=\s)/g;
  let start = -1;
  for (const match of text.matchAll(prefixPattern)) {
    if ((match.index ?? 0) > firstValueIndex) break;
    start = match.index ?? 0;
  }
  if (start < 0) return false;

  const boundary = text.indexOf(CLAUSE_BREAK, firstValueIndex);
  const clause = text.slice(start, boundary >= 0 ? boundary : undefined);
  return /(?:^|\s)(?:o|oppure)(?=\s|$)/.test(clause);
}

const WEEKDAY_INDEX: Record<string, number> = {
  domenica: 0,
  lunedi: 1,
  martedi: 2,
  mercoledi: 3,
  giovedi: 4,
  venerdi: 5,
  sabato: 6,
};

function weekdayInRome(referenceDate: Date) {
  const formatted = new Intl.DateTimeFormat('it-IT', {
    timeZone: 'Europe/Rome',
    weekday: 'long',
  }).format(referenceDate);
  return WEEKDAY_INDEX[normaliseItalian(formatted)] ?? referenceDate.getUTCDay();
}

function requestedServiceTime(text: string, referenceDate: Date): SearchIntent['requestedServiceTime'] {
  const temporalNegated = /(?:non|niente|senza)\s+(?:(?:necessariamente|per\s+forza|serve|deve\s+essere|apert[oa]|disponibile|per)\s+){0,5}(?:stasera|questa\s+sera|domani|dopodomani)\b/.test(text);
  if (temporalNegated) return undefined;
  const optionalClock = /(?:non\s+(?:necessariamente|per\s+forza)|non\s+e\s+necessari[oa](?:\s+che\s+sia)?|non\s+serve(?:\s+che\s+sia)?)\s+(?:apert[oa]\s+|disponibile\s+)?(?:alle|ore|verso\s+le)\s+\d{1,2}(?:\s+\d{2})?\b/.test(text);
  if (optionalClock) return undefined;

  const today = weekdayInRome(referenceDate);
  const namedDay = Object.entries(WEEKDAY_INDEX).find(([label]) => containsPhrase(text, label));
  const dayOffset = containsPhrase(text, 'dopodomani') ? 2 : containsPhrase(text, 'domani') ? 1 : 0;
  const weekday = namedDay?.[1] ?? ((today + dayOffset) % 7);

  const clock = text.match(/(?:^|\s)(?:alle|ore|verso\s+le)\s+(\d{1,2})(?:\s+(\d{2}))?(?=\s|$)/);
  const explicitHour = clock ? Number(clock[1]) : undefined;
  const explicitMinutes = clock?.[2] ? Number(clock[2]) : 0;
  if (explicitHour !== undefined && explicitHour < 24 && explicitMinutes < 60) {
    return {
      weekday,
      minutes: explicitHour * 60 + explicitMinutes,
      label: `alle ${String(explicitHour).padStart(2, '0')}:${String(explicitMinutes).padStart(2, '0')}`,
    };
  }

  if (containsPhrase(text, 'dopo mezzanotte')) {
    return {
      weekday: namedDay ? (weekday + 1) % 7 : (today + 1) % 7,
      minutes: 30,
      label: 'dopo mezzanotte',
    };
  }

  const evening = containsPhrase(text, 'stasera')
    || containsPhrase(text, 'questa sera')
    || ((dayOffset > 0 || namedDay) && containsPhrase(text, 'sera'));
  if (evening) return { weekday, minutes: 20 * 60 + 30, label: 'alle 20:30' };

  if ((dayOffset > 0 || namedDay) && containsPhrase(text, 'pranzo')) {
    return { weekday, minutes: 13 * 60, label: 'alle 13:00' };
  }

  return undefined;
}

export function parseIntent(query: string, selectedOccasion?: string, referenceDate = new Date()): SearchIntent {
  const text = normaliseItalian(
    query
      .replace(/\b(budget|prezzo|spesa)\s*:\s*/giu, '$1 ')
      .replace(/(\d):(\d)/g, '$1 $2')
      .replace(/[,;:.!?]+/g, ` ${CLAUSE_BREAK} `)
      .replace(/\bma\b(?!\s+anche)/giu, ` ${CLAUSE_BREAK} `)
      .replace(/\b(?:però|pero|invece|meglio)\b/giu, ` ${CLAUSE_BREAK} `),
  );
  const categories = findLexiconMatches(text, CATEGORY_LEXICON);
  const neighborhoodLexicon = NEIGHBORHOOD_ENTRIES;
  const neighborhoods = findLexiconMatches(text, neighborhoodLexicon);
  const originNeighborhood = NEIGHBORHOOD_ENTRIES.find((entry) =>
    [entry.value, ...entry.aliases].some((alias) => new RegExp(
      `(?:^|\\s)\\d{1,2}\\s*(?:min|minuti)\\s+(?:da|dal|dalla|dai|dagli|dalle)\\s+${phrasePattern(alias)}(?=\\s|$)`,
    ).test(text)),
  )?.value;
  const positiveNeighborhoods = neighborhoods.positive.filter((value) => value !== originNeighborhood);
  const atmospheres = findLexiconMatches(text, ATMOSPHERE_LEXICON);
  const atmosphereUsesAlternative = atmospheres.required.length > 1
    && requiredValuesUseAlternative(text, atmospheres.required, ATMOSPHERE_LEXICON);
  const queryOccasions = findLexiconMatches(text, OCCASION_LEXICON);
  const concepts = findLexiconMatches(text, CONCEPT_LEXICON);
  const selected = canonicalSelectedOccasion(selectedOccasion);
  const occasions = unique([...(selected ? [selected] : []), ...queryOccasions.positive]);
  const optionalSemanticTokens = new Set([
    ...lexiconTokensForValues(categories.optional, CATEGORY_LEXICON),
    ...lexiconTokensForValues(neighborhoods.optional, neighborhoodLexicon),
    ...lexiconTokensForValues(atmospheres.optional, ATMOSPHERE_LEXICON),
    ...lexiconTokensForValues(queryOccasions.optional, OCCASION_LEXICON),
    ...lexiconTokensForValues(concepts.optional, CONCEPT_LEXICON),
    ...(originNeighborhood ? lexiconTokensForValues([originNeighborhood], NEIGHBORHOOD_ENTRIES) : []),
  ]);

  const prefixedMaxSpendMatch = text.match(
    /(?:sotto|entro|max|massimo|budget(?:\s+di)?|meno\s+di|non\s+piu\s+di|non\s+oltre|fino\s+a|senza\s+spendere\s+piu\s+di)\s*(?:i\s*)?(?:€\s*(\d{1,3})|(\d{1,3})\s*(?:€(?=\s|$)|euro\b))/,
  );
  const suffixedMaxSpendMatch = text.match(
    /(?:€\s*(\d{1,3})|(\d{1,3})\s*(?:€(?=\s|$)|euro\b))\s*(?:al\s+)?(?:massimo|max)\b/,
  );
  const bareBudgetMatch = text.match(/(?:^|\s)budget(?:\s+di)?\s*(\d{1,3})(?=\s|$)/);
  const standaloneEuroSpendMatch = text.match(/(?:^|\s)€\s*(\d{1,3})(?=\s|$)/);
  const approximateSpendMatch = text.match(
    /(?:circa|intorno\s+(?:a|ai)|sui)\s*(?:€\s*)?(\d{1,3})\s*(?:€(?=\s|$)|euro\b)/,
  );
  const perPersonSpendMatch = text.match(
    /(?:€\s*(\d{1,3})|(\d{1,3})\s*(?:€(?=\s|$)|euro\b))\s+(?:a|per)\s+persona\b/,
  );
  const rawSpendRangeMatch = text.match(
    /\btra\s+(?:€\s*)?(\d{1,3})\s*(?:€|euro)?\s+(?:e|a)\s+(?:€\s*)?(\d{1,3})\s*(?:€|euro)?(?=\s|$)/,
  );
  const spendRangeMatch = rawSpendRangeMatch && /(?:€|euro)/.test(rawSpendRangeMatch[0])
    ? rawSpendRangeMatch
    : null;
  const spendRangeMin = spendRangeMatch
    ? Math.min(Number(spendRangeMatch[1]), Number(spendRangeMatch[2]))
    : undefined;
  const spendRangeMax = spendRangeMatch
    ? Math.max(Number(spendRangeMatch[1]), Number(spendRangeMatch[2]))
    : undefined;
  const qualitativeAffordable = /\b(?:economico|economica|spendere\s+poco|non\s+troppo\s+costoso|non\s+troppo\s+costosa|prezzo\s+contenuto|prezzi\s+contenuti)\b/.test(text);
  const maxSpendValue = prefixedMaxSpendMatch?.[1]
    ?? prefixedMaxSpendMatch?.[2]
    ?? suffixedMaxSpendMatch?.[1]
    ?? suffixedMaxSpendMatch?.[2]
    ?? bareBudgetMatch?.[1]
    ?? (spendRangeMax !== undefined ? String(spendRangeMax) : undefined)
    ?? standaloneEuroSpendMatch?.[1]
    ?? approximateSpendMatch?.[1]
    ?? perPersonSpendMatch?.[1]
    ?? perPersonSpendMatch?.[2]
    ?? (qualitativeAffordable ? String(RANKING_THRESHOLDS.affordableMaxSpend) : undefined);
  const maxMinutesMatch = text.match(
    /(?:entro|max|massimo|non\s+piu\s+di|(?:a\s+)?meno\s+di)\s*(?:i\s*)?(\d{1,2})\s*(?:min|minuti)\b/,
  );
  const walkingMinutesMatch = text.match(/(?:^|\s)(\d{1,2})\s*(?:min|minuti)\s+(?:a\s+piedi|camminando)\b/);
  const originMinutesMatch = text.match(/(?:^|\s)(\d{1,2})\s*(?:min|minuti)\s+(?:da|dal|dalla|dai|dagli|dalle)\s+/);
  const quarterHourMatch = /\b(?:un\s+)?quarto\s+d\s+ora\b/.test(text);
  const partySizeMatch = text.match(
    /\b(?:per\s+)?(\d+)\s+(?:persone|commensali)\b|\b(?:siamo|saremo|veniamo)\s+(?:in\s+)?(\d+)\b|\b(?:tavolo|prenotazione)\s+(?:per|da)\s+(\d+)\b/,
  );
  const partySizeWordMatch = text.match(new RegExp(
    `\\b(?:per\\s+)?(${PARTY_SIZE_WORD_PATTERN})\\s+(?:persone|commensali)\\b|\\b(?:siamo|saremo|veniamo)\\s+(?:in\\s+)?(${PARTY_SIZE_WORD_PATTERN})\\b|\\b(?:tavolo|prenotazione)\\s+(?:per|da)\\s+(${PARTY_SIZE_WORD_PATTERN})\\b`,
  ));
  const partySizeWord = partySizeWordMatch
    ? PARTY_SIZE_WORDS[
        (partySizeWordMatch[1] ?? partySizeWordMatch[2] ?? partySizeWordMatch[3]) as keyof typeof PARTY_SIZE_WORDS
      ]
    : undefined;
  const parsedPartySize = partySizeMatch
    ? Number(partySizeMatch[1] ?? partySizeMatch[2] ?? partySizeMatch[3])
    : partySizeWord;
  const partySize = parsedPartySize !== undefined && parsedPartySize >= 1 && parsedPartySize <= 50
    ? parsedPartySize
    : undefined;
  const requestsUnverifiedCapacity = partySizeMatch !== null
    || partySizeWordMatch !== null
    || /\b(?:tavol[oi]\s+grand[ei]|grand[ei]\s+grupp[oi]|grupp[oi]\s+numeros[oi]|comitiv[ae])\b/.test(text);
  const openNowNegated = /(?:non|senza)\s+(?:(?:necessariamente|per\s+forza|serve|deve\s+essere|bisogno(?:\s+che\s+sia|\s+di)?|che\s+sia)\s+)*(?:apert[oa]\s+)?(?:ora|adesso)\b/.test(text);
  const serviceTime = requestedServiceTime(text, referenceDate);
  const unsupportedConstraints: SearchIntent['unsupportedConstraints'] = [];
  const hasAmbiguousTimeRange = /\b(?:entro\s+le|dopo\s+le|prima\s+delle)\s+\d{1,2}(?:\s+\d{2})?\b/.test(text);
  const hasInvalidClock = /\b(?:alle|ore|verso\s+le)\s+(?:2[4-9]|[3-9]\d)(?:\s+\d{2})?\b/.test(text)
    || /\b(?:alle|ore|verso\s+le)\s+\d{1,2}\s+(?:[6-9]\d)\b/.test(text);
  const hasDayWithoutServiceTime = /\b(?:domani|dopodomani|lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)\b/.test(text)
    && !serviceTime;
  if (hasAmbiguousTimeRange || hasInvalidClock || hasDayWithoutServiceTime) {
    unsupportedConstraints.push({ code: 'EXACT_OPENING_TIME', label: 'apertura per giorno o orario specifico' });
  }
  if (/\b(?:senza\s+glutine|gluten\s+free|celiach|senza\s+lattosio|lactose\s+free|allerg|arachid|frutta\s+secca)\w*/.test(text)) {
    unsupportedConstraints.push({ code: 'DIETARY_SAFETY', label: 'requisiti alimentari o allergeni' });
  }
  if (/\b(?:sedia\s+a\s+rotelle|carrozzina|senza\s+barriere|bagno\s+accessibile|disabil)\w*/.test(text)) {
    unsupportedConstraints.push({ code: 'ACCESSIBILITY', label: 'accessibilità verificata' });
  }
  if (requestsUnverifiedCapacity) {
    unsupportedConstraints.push({
      code: 'PARTY_SIZE',
      label: partySize ? `capienza verificata per ${partySize} persone` : 'capienza verificata per gruppi numerosi',
    });
  }
  if (/\b(?:area\s+bambini|seggiolone|fasciatoio|guardaroba|ricarica\s+elettrica|colonnina\s+elettrica)\b/.test(text)) {
    unsupportedConstraints.push({ code: 'UNVERIFIED_SERVICE', label: 'servizio richiesto non verificabile nel catalogo' });
  }
  if (/\b(?:halal|kosher|pescetarian\w*)\b/.test(text)) {
    unsupportedConstraints.push({
      code: 'UNVERIFIED_DIETARY_OPTION',
      label: 'opzione alimentare richiesta non verificabile nel catalogo',
    });
  }
  if (originNeighborhood && originNeighborhood !== 'Duomo') {
    unsupportedConstraints.push({ code: 'TRAVEL_ORIGIN', label: `tempi di viaggio verificati da ${originNeighborhood}` });
  }

  return {
    query,
    category: categories.positive[0],
    categories: categories.positive,
    requiredCategories: categories.required,
    excludedCategories: categories.excluded,
    neighborhood: positiveNeighborhoods[0],
    neighborhoods: positiveNeighborhoods,
    requiredNeighborhoods: neighborhoods.required,
    excludedNeighborhoods: neighborhoods.excluded,
    minSpend: spendRangeMin,
    maxSpend: maxSpendValue ? Number(maxSpendValue) : undefined,
    maxMinutes: maxMinutesMatch
      ? Number(maxMinutesMatch[1])
      : walkingMinutesMatch
        ? Number(walkingMinutesMatch[1])
        : originMinutesMatch
          ? Number(originMinutesMatch[1])
          : quarterHourMatch
            ? 15
            : undefined,
    partySize,
    travelOriginId: originNeighborhood === 'Duomo' ? 'milano-duomo-centroid' : undefined,
    requiresOpenNow:
      !openNowNegated && /(?:aperto|aperta|disponibile)\s+(?:ora|adesso)|\badesso\b/.test(text),
    requestedServiceTime: serviceTime,
    atmosphere: atmospheres.positive,
    requiredAtmosphere: atmosphereUsesAlternative ? [] : atmospheres.required,
    requiredAtmosphereAny: atmosphereUsesAlternative ? atmospheres.required : [],
    excludedAtmosphere: atmospheres.excluded,
    occasion: occasions[0],
    occasions,
    requiredOccasions: queryOccasions.required,
    excludedOccasions: queryOccasions.excluded,
    concepts: concepts.positive,
    requiredConcepts: concepts.required,
    excludedConcepts: concepts.excluded,
    semanticTokens: semanticTokens(query).filter((token) => !optionalSemanticTokens.has(token)),
    unsupportedConstraints,
  };
}

function venueSearchText(venue: Venue) {
  return normaliseItalian(
    [
      venue.name,
      venue.neighborhood,
      venue.category,
      ...venue.atmosphere,
      ...venue.occasions,
      ...venue.features,
      ...(venue.semanticTags ?? []),
    ].join(' '),
  );
}

function structuredFieldContains(field: string, phrase: string) {
  const normalizedField = normaliseItalian(field);
  const normalizedPhrase = normaliseItalian(phrase);
  return Boolean(
    normalizedField
      && normalizedPhrase
      && ` ${normalizedField} `.includes(` ${normalizedPhrase} `),
  );
}

function venueMatchesConcept(venue: Venue, concept: string) {
  const entry = CONCEPT_LEXICON.find((candidate) => candidate.value === concept);
  const aliases = entry?.aliases ?? [concept];
  return venue.features.some((field) => (
    [concept, ...aliases].some((alias) => structuredFieldContains(field, alias))
  ));
}

function venueMatchesOccasion(venue: Venue, occasion: string) {
  const entry = OCCASION_LEXICON.find((candidate) => candidate.value === occasion);
  return venue.occasions.some((field) => (
    [occasion, ...(entry?.aliases ?? [])].some((alias) => structuredFieldContains(field, alias))
  ));
}

type PreferenceDimension = 'categoria' | 'zona' | 'occasione' | 'atmosfera' | 'caratteristica';

function preferenceSignature(venue: Venue, intent: SearchIntent) {
  return {
    categoria: intent.categories.length ? Number(intent.categories.includes(venue.category)) : undefined,
    zona: intent.neighborhoods.length ? Number(intent.neighborhoods.includes(venue.neighborhood)) : undefined,
    occasione: intent.occasions.length
      ? intent.occasions.filter((occasion) => venueMatchesOccasion(venue, occasion)).length
      : undefined,
    atmosfera: intent.atmosphere.length
      ? intent.atmosphere.filter((mood) => venue.atmosphere.includes(mood)).length
      : undefined,
    caratteristica: intent.concepts.length
      ? intent.concepts.filter((concept) => venueMatchesConcept(venue, concept)).length
      : undefined,
  } satisfies Record<PreferenceDimension, number | undefined>;
}

function preferenceDivergences(reference: Venue, candidate: Venue, intent: SearchIntent): PreferenceDimension[] {
  const baseline = preferenceSignature(reference, intent);
  const comparison = preferenceSignature(candidate, intent);
  return (Object.keys(baseline) as PreferenceDimension[]).filter(
    (dimension) => baseline[dimension] !== undefined && baseline[dimension] !== comparison[dimension],
  );
}

export function respectsHardConstraints(
  venue: Venue,
  intent: SearchIntent,
  at = Date.now(),
  context?: RankingContext,
) {
  if (!isVenueRankingEligible(venue, at)) return false;
  const reducedCatalogEvidence = venue.catalogApiRankingEvidence?.source === 'catalog-api';
  if (intent.excludedCategories.includes(venue.category)) return false;
  if (intent.requiredCategories.length && !intent.requiredCategories.includes(venue.category)) return false;
  if (intent.excludedNeighborhoods.includes(venue.neighborhood)) return false;
  if (intent.requiredNeighborhoods.length && !intent.requiredNeighborhoods.includes(venue.neighborhood)) return false;
  if ((intent.minSpend !== undefined || intent.maxSpend !== undefined) && !hasKnownVenuePricing(venue)) return false;
  if (intent.minSpend !== undefined && venue.averageSpend < intent.minSpend) return false;
  if (intent.maxSpend !== undefined && venue.averageSpend > intent.maxSpend) return false;
  if (intent.maxMinutes !== undefined && effectiveTravelMinutes(venue, context) > intent.maxMinutes) return false;
  if (intent.travelOriginId && !sessionEstimateFor(venue, context) && venue.travelEstimate.origin.id !== intent.travelOriginId) return false;
  if (intent.requiresOpenNow && (!hasUsableOpenStatus(venue, at) || !venue.openStatus.value)) return false;
  if (intent.requestedServiceTime && !isVenueAvailableAt(
    venue,
    intent.requestedServiceTime.weekday,
    intent.requestedServiceTime.minutes,
    at,
  )) return false;
  if (intent.requiredAtmosphere.some((mood) => !venue.atmosphere.includes(mood))) return false;
  if (intent.requiredAtmosphereAny.length && !intent.requiredAtmosphereAny.some((mood) => venue.atmosphere.includes(mood))) return false;
  // The public catalog projection currently exposes verified positive service
  // rows, but not authoritative negative claims for mood, occasion or service.
  // An exclusion therefore cannot be proven for an API venue and fails closed.
  if (reducedCatalogEvidence && (
    intent.excludedAtmosphere.length
      || intent.excludedOccasions.length
      || intent.excludedConcepts.length
  )) return false;
  if (intent.excludedAtmosphere.some((mood) => venue.atmosphere.includes(mood))) return false;
  if (intent.excludedOccasions.some((occasion) => venueMatchesOccasion(venue, occasion))) return false;
  if (intent.requiredOccasions.some((occasion) => !venueMatchesOccasion(venue, occasion))) return false;
  if (intent.requiredConcepts.some((concept) => !venueMatchesConcept(venue, concept))) return false;
  if (intent.excludedConcepts.some((concept) => venueMatchesConcept(venue, concept))) return false;
  return true;
}

type MatchEvidence = {
  score: number;
  codes: RankingReasonCode[];
  phrases: string[];
  concepts: string[];
  profileMatches: string[];
};

function addEvidence(
  evidence: MatchEvidence,
  score: number,
  code: RankingReasonCode,
  phrase?: string,
  concept?: string,
) {
  evidence.score += score;
  if (!evidence.codes.includes(code)) evidence.codes.push(code);
  if (phrase && !evidence.phrases.includes(phrase)) evidence.phrases.push(phrase);
  if (concept && !evidence.concepts.includes(concept)) evidence.concepts.push(concept);
}

function scoreVenue(
  venue: Venue,
  intent: SearchIntent,
  tasteProfile?: TasteProfile | null,
  at = Date.now(),
  context?: RankingContext,
): MatchEvidence {
  const travelMinutes = effectiveTravelMinutes(venue, context);
  const evidence: MatchEvidence = {
    score:
      venue.confidence * RANKING_WEIGHTS.confidence
      + Math.max(0, RANKING_THRESHOLDS.proximityReferenceMinutes - travelMinutes)
        * RANKING_WEIGHTS.travelMinute,
    codes: ['GOLD_ELIGIBLE'],
    phrases: [],
    concepts: [],
    profileMatches: [],
  };

  if (venue.confidence >= RANKING_THRESHOLDS.highConfidence) addEvidence(evidence, 0, 'HIGH_CONFIDENCE');
  if (travelMinutes <= RANKING_THRESHOLDS.closeByMinutes) addEvidence(evidence, 0, 'CLOSE_BY');
  if (hasUsableOpenStatus(venue, at) && venue.openStatus.value) addEvidence(evidence, RANKING_WEIGHTS.openNow, 'OPEN_NOW');
  if (intent.requiresOpenNow && venue.openStatus.value) {
    evidence.phrases.push(
      venue.openStatus.source === 'fixture'
        ? 'aperto ora nel dataset dimostrativo'
        : `aperto ora · stato verificato ${venue.openStatus.checkedAt.slice(0, 10)}`,
    );
  }
  if (intent.minSpend !== undefined && intent.maxSpend !== undefined) {
    evidence.phrases.push(`nella fascia €${intent.minSpend}–€${intent.maxSpend}`);
  } else if (intent.maxSpend !== undefined) {
    evidence.phrases.push(`entro il budget di €${intent.maxSpend}`);
  }
  if (intent.maxMinutes !== undefined) evidence.phrases.push(`entro ${intent.maxMinutes} minuti`);
  if (intent.requestedServiceTime) {
    evidence.phrases.push(
      `disponibile ${intent.requestedServiceTime.label} · ${venue.availability.source === 'fixture' ? 'orari dimostrativi' : `orari verificati ${venue.availability.checkedAt.slice(0, 10)}`}`,
    );
  }
  if (
    !intent.categories.length
    && !intent.neighborhoods.length
    && !intent.atmosphere.length
    && !intent.occasions.length
    && !intent.concepts.length
    && (
      intent.requiredCategories.length
      || intent.excludedCategories.length
      || intent.requiredNeighborhoods.length
      || intent.excludedNeighborhoods.length
      || intent.requiredAtmosphere.length
      || intent.requiredAtmosphereAny.length
      || intent.excludedAtmosphere.length
      || intent.requiredOccasions.length
      || intent.requiredConcepts.length
      || intent.excludedConcepts.length
    )
  ) evidence.phrases.push('rispetta i filtri richiesti');

  const categoryIndex = intent.categories.indexOf(venue.category);
  if (categoryIndex >= 0) {
    addEvidence(
      evidence,
      categoryIndex === 0 ? RANKING_WEIGHTS.categoryPrimary : RANKING_WEIGHTS.categorySecondary,
      'CATEGORY_MATCH',
      `categoria ${venue.category.toLocaleLowerCase('it-IT')}`,
    );
  }

  const neighborhoodIndex = intent.neighborhoods.indexOf(venue.neighborhood);
  if (neighborhoodIndex >= 0) {
    addEvidence(
      evidence,
      neighborhoodIndex === 0 ? RANKING_WEIGHTS.neighborhoodPrimary : RANKING_WEIGHTS.neighborhoodSecondary,
      'NEIGHBORHOOD_MATCH',
      `in zona ${venue.neighborhood}`,
    );
  }

  const occasionMatches = intent.occasions.filter((occasion) => venueMatchesOccasion(venue, occasion));
  occasionMatches.slice(0, RANKING_THRESHOLDS.evidenceMatchesPerSignal).forEach((occasion, index) => {
    addEvidence(
      evidence,
      index === 0 ? RANKING_WEIGHTS.occasionPrimary : RANKING_WEIGHTS.occasionSecondary,
      'OCCASION_MATCH',
      `pensato per ${occasion}`,
      occasion,
    );
  });

  const atmosphereMatches = intent.atmosphere.filter((mood) => venue.atmosphere.includes(mood));
  atmosphereMatches.slice(0, RANKING_THRESHOLDS.evidenceMatchesPerSignal).forEach((mood, index) => {
    addEvidence(
      evidence,
      index === 0 ? RANKING_WEIGHTS.atmospherePrimary : RANKING_WEIGHTS.atmosphereSecondary,
      'ATMOSPHERE_MATCH',
      `atmosfera ${mood}`,
      mood,
    );
  });

  const conceptMatches = intent.concepts.filter((concept) => venueMatchesConcept(venue, concept));
  conceptMatches.forEach((concept) => {
    const weight = CONCEPT_WEIGHTS[concept] ?? RANKING_WEIGHTS.conceptDefault;
    addEvidence(evidence, weight, 'FEATURE_MATCH', concept, concept);
  });

  const venueTokens = semanticTokens(venueSearchText(venue));
  const sharedTokens = intent.semanticTokens.filter((token) => venueTokens.includes(token));
  const ignoredTokens = new Set([
    ...CATEGORY_LEXICON.flatMap((entry) => entry.aliases.flatMap(semanticTokens)),
    ...NEIGHBORHOOD_ENTRIES.flatMap((entry) => [entry.value, ...entry.aliases].flatMap(semanticTokens)),
    'tavol',
    'grand',
    'budget',
    'euro',
    'massim',
    'minut',
    'apert',
    'sera',
    'stasera',
    'domani',
  ]);
  const residualSharedTokens = sharedTokens.filter((token) => !ignoredTokens.has(token));
  if (residualSharedTokens.length) {
    const similarity = residualSharedTokens.length / Math.sqrt(Math.max(1, intent.semanticTokens.length * venueTokens.length));
    addEvidence(
      evidence,
      Math.min(RANKING_THRESHOLDS.semanticScoreMaximum, similarity * RANKING_WEIGHTS.semanticSimilarity),
      'SEMANTIC_MATCH',
    );
  }

  // Profilo locale: dopo hard eligibility. Intensità slider + soft-cap
  // (vedi tasteProfileAffinity). Può raffinare l’ordine, mai rilassare vincoli.
  // Punteggio anche negativo (mismatch lieve) ma con floor controllato.
  const profileAffinity = tasteProfileAffinity(venue, tasteProfile);
  if (profileAffinity.score !== 0 || profileAffinity.matches.length) {
    if (profileAffinity.score !== 0) {
      addEvidence(
        evidence,
        profileAffinity.score,
        'PROFILE_MATCH',
        profileAffinity.matches.length
          ? `profilo locale: ${profileAffinity.matches.slice(0, RANKING_THRESHOLDS.evidenceMatchesPerSignal).join(', ')}`
          : undefined,
      );
    } else if (profileAffinity.matches.length) {
      addEvidence(
        evidence,
        0,
        'PROFILE_MATCH',
        `profilo locale: ${profileAffinity.matches.slice(0, RANKING_THRESHOLDS.evidenceMatchesPerSignal).join(', ')}`,
      );
    }
    evidence.profileMatches = profileAffinity.matches;
  }

  return evidence;
}

function explanationFor(venue: Venue, evidence: MatchEvidence, context?: RankingContext) {
  const sessionEstimate = sessionEstimateFor(venue, context);
  const derivedCandidates = [
    ...evidence.phrases,
    ...(evidence.codes.includes('CLOSE_BY')
      ? [sessionEstimate
          ? `${sessionEstimate.minutes} minuti dalla tua posizione · ${sessionEstimate.disclosure}`
          : `${venue.travelEstimate.minutes} minuti da ${venue.travelEstimate.origin.shortLabel}`]
      : []),
    ...(evidence.codes.includes('HIGH_CONFIDENCE') ? ['selezione ad alta confidenza'] : []),
    ...venue.features.map((feature) => `caratteristica: ${feature}`),
    `in zona ${venue.neighborhood}`,
    `categoria ${venue.category.toLocaleLowerCase('it-IT')}`,
  ];
  const phrases: string[] = [];

  for (const candidate of derivedCandidates) {
    const phrase = candidate.trim();
    const normalisedPhrase = normaliseItalian(phrase);
    if (
      !phrase
      || phrases.some((current) => {
        const normalisedCurrent = normaliseItalian(current);
        return normalisedCurrent === normalisedPhrase
          || normalisedCurrent.includes(normalisedPhrase)
          || normalisedPhrase.includes(normalisedCurrent);
      })
    ) continue;
    phrases.push(phrase);
    if (phrases.length === RANKING_THRESHOLDS.explanationReasonLimit) break;
  }

  return phrases.join('; ');
}

export type RankingOverrides = Partial<Omit<SearchIntent, 'query' | 'semanticTokens'>> & {
  semanticTokens?: string[];
};

export function applyRankingOverrides(intent: SearchIntent, overrides: RankingOverrides): SearchIntent {
  const merged = { ...intent, ...overrides };

  // Scalar UI controls are authoritative and must not inherit a stale query
  // value in the corresponding multi-value collection.
  if (overrides.category !== undefined && overrides.categories === undefined) {
    merged.categories = overrides.category ? [overrides.category] : [];
  }
  if (overrides.categories !== undefined) merged.category = overrides.categories[0];
  if (overrides.category !== undefined || overrides.categories !== undefined) {
    if (overrides.requiredCategories === undefined) merged.requiredCategories = merged.categories;
    if (overrides.excludedCategories === undefined) merged.excludedCategories = [];
  }
  if (overrides.neighborhood !== undefined && overrides.neighborhoods === undefined) {
    merged.neighborhoods = overrides.neighborhood ? [overrides.neighborhood] : [];
  }
  if (overrides.neighborhoods !== undefined) merged.neighborhood = overrides.neighborhoods[0];
  if (overrides.neighborhood !== undefined || overrides.neighborhoods !== undefined) {
    if (overrides.requiredNeighborhoods === undefined) merged.requiredNeighborhoods = merged.neighborhoods;
    if (overrides.excludedNeighborhoods === undefined) merged.excludedNeighborhoods = [];
  }

  return merged;
}

export function rankVenues(
  query: string,
  selectedOccasion?: string,
  source: Venue[] = defaultVenues,
  overrides: RankingOverrides = {},
  tasteProfile?: TasteProfile | null,
  referenceDate = new Date(),
  context?: RankingContext,
): RankedVenue[] {
  const intent = applyRankingOverrides(parseIntent(query, selectedOccasion, referenceDate), overrides);
  if (intent.unsupportedConstraints.length) return [];
  const referenceTime = referenceDate.getTime();
  const candidates = source
    .filter((venue) => respectsHardConstraints(venue, intent, referenceTime, context))
    .map((venue) => ({ venue, evidence: scoreVenue(venue, intent, tasteProfile, referenceTime, context) }))
    .sort(
      (a, b) =>
        b.evidence.score - a.evidence.score ||
        b.venue.confidence - a.venue.confidence ||
        effectiveTravelMinutes(a.venue, context) - effectiveTravelMinutes(b.venue, context) ||
        a.venue.id.localeCompare(b.venue.id, 'it-IT'),
    );

  if (!candidates.length) return [];

  const first = candidates[0];
  const intentHasStructuredPositiveSignals = Boolean(
    intent.categories.length
      || intent.neighborhoods.length
      || intent.atmosphere.length
      || intent.occasions.length
      || intent.concepts.length,
  );
  const intentHasHardSignals = Boolean(
    intent.minSpend !== undefined
      || intent.maxSpend !== undefined
      || intent.maxMinutes !== undefined
      || intent.travelOriginId
      || intent.requiresOpenNow
      || intent.requestedServiceTime
      || intent.requiredCategories.length
      || intent.excludedCategories.length
      || intent.requiredNeighborhoods.length
      || intent.excludedNeighborhoods.length
      || intent.requiredAtmosphere.length
      || intent.requiredAtmosphereAny.length
      || intent.excludedAtmosphere.length
      || intent.requiredOccasions.length
      || intent.requiredConcepts.length
      || intent.excludedConcepts.length,
  );
  const hasQueryEvidence = (evidence: MatchEvidence) => {
    if (!query.trim() && !selectedOccasion) return true;
    if (intentHasStructuredPositiveSignals) {
      return Boolean(
        (intent.categories.length && evidence.codes.includes('CATEGORY_MATCH'))
        || (intent.neighborhoods.length && evidence.codes.includes('NEIGHBORHOOD_MATCH'))
        || (intent.occasions.length && evidence.codes.includes('OCCASION_MATCH'))
        || (intent.atmosphere.length && evidence.codes.includes('ATMOSPHERE_MATCH'))
        || (intent.concepts.length && evidence.codes.includes('FEATURE_MATCH'))
        // Free editorial prose may improve recall for optional preferences,
        // but remains generic evidence and never satisfies a hard constraint.
        || evidence.codes.includes('SEMANTIC_MATCH'),
      );
    }
    if (intentHasHardSignals) return true;
    return evidence.codes.includes('SEMANTIC_MATCH');
  };
  if (!hasQueryEvidence(first.evidence)) return [];
  const relevantCandidates = candidates.filter(({ evidence }) => hasQueryEvidence(evidence));
  const second =
    relevantCandidates
      .slice(1)
      .find(
        ({ venue, evidence }) =>
          evidence.score >= first.evidence.score * RANKING_THRESHOLDS.safeAlternativeMinimumScoreRatio &&
          preferenceDivergences(first.venue, venue, intent).length === 0 &&
          (venue.neighborhood !== first.venue.neighborhood || venue.category !== first.venue.category),
      );
  const used = new Set([first?.venue.id, second?.venue.id]);
  const wildcard = second
    ? relevantCandidates.find(
      ({ venue, evidence }) =>
        !used.has(venue.id) &&
        evidence.score >= first.evidence.score * RANKING_THRESHOLDS.wildcardMinimumScoreRatio &&
        preferenceDivergences(first.venue, venue, intent).length === 1,
      )
    : undefined;
  const normalThird = second
    ? relevantCandidates.find(({ venue }) => !used.has(venue.id))
    : undefined;
  const third = wildcard ?? normalThird;
  const thirdRole: RankedVenue['role'] = wildcard ? 'smart-wildcard' : 'safe-alternative';

  const asRanked = (
    candidate: (typeof candidates)[number] | undefined,
    rank: 1 | 2 | 3,
    role: RankedVenue['role'],
  ): RankedVenue | undefined => {
    if (!candidate) return undefined;
    const { venue, evidence } = candidate;
    const sessionTravelEstimate = sessionEstimateFor(venue, context);
    const prefix = rank === 1
      ? 'La scelta più coerente'
      : role === 'smart-wildcard'
        ? 'Wildcard controllata'
        : rank === 3
          ? 'Alternativa rilevante'
          : 'Alternativa solida';
    const roleCode: RankingReasonCode | undefined =
      role === 'smart-wildcard'
        ? 'CONTROLLED_WILDCARD'
        : rank > 1
          ? 'DIVERSITY_ALTERNATIVE'
          : undefined;
    const reasonCodes = roleCode ? [...evidence.codes, roleCode] : evidence.codes;
    const divergenceDimensions = rank === 1 ? [] : preferenceDivergences(first.venue, venue, intent);
    const alternativeDifference = venue.neighborhood !== first.venue.neighborhood
      ? `cambia zona: ${venue.neighborhood}`
      : venue.category !== first.venue.category
        ? `cambia categoria: ${venue.category}`
        : 'cambia interpretazione mantenendo gli stessi criteri';
    return {
      ...venue,
      ...(sessionTravelEstimate ? { sessionTravelEstimate } : {}),
      rank,
      role,
      score: Number(evidence.score.toFixed(4)),
      reason: `${prefix}: ${explanationFor(venue, evidence, context)}.`,
      reasonCodes,
      matchedConcepts: evidence.concepts,
      profileMatches: evidence.profileMatches,
      divergenceDimensions,
      tradeoff:
        rank === 1
          ? 'Massima coerenza complessiva'
          : role === 'smart-wildcard'
            ? `Deviazione controllata: ${divergenceDimensions[0]}. Coerente sugli altri criteri.`
            : rank === 3
              ? `Alternativa rilevante, ${
                divergenceDimensions.length
                  ? `differisce per ${divergenceDimensions.join(', ')}`
                  : alternativeDifference
              }; nessuna deviazione wildcard applicata.`
              : `Stessa intenzione, ${alternativeDifference}`,
    };
  };

  return [
    asRanked(first, 1, 'best-fit'),
    asRanked(second, 2, 'safe-alternative'),
    asRanked(third, 3, thirdRole),
  ].filter(Boolean) as RankedVenue[];
}
