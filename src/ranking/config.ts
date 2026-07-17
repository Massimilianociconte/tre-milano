/**
 * Versioned deterministic ranking configuration.
 *
 * Any behavioural change to parsing, scoring or podium composition must bump
 * this value and update the reviewed golden dataset in the same change.
 */
export const RANKING_VERSION = 'deterministic-local-v2' as const;

export const RANKING_WEIGHTS = Object.freeze({
  confidence: 24,
  travelMinute: 0.45,
  openNow: 3,
  categoryPrimary: 24,
  categorySecondary: 18,
  neighborhoodPrimary: 20,
  neighborhoodSecondary: 13,
  occasionPrimary: 19,
  occasionSecondary: 9,
  atmospherePrimary: 13,
  atmosphereSecondary: 7,
  semanticSimilarity: 38,
  conceptDefault: 7,
} as const);

export const RANKING_THRESHOLDS = Object.freeze({
  affordableMaxSpend: 35,
  proximityReferenceMinutes: 18,
  closeByMinutes: 10,
  highConfidence: 0.92,
  semanticScoreMaximum: 10,
  safeAlternativeMinimumScoreRatio: 0.5,
  wildcardMinimumScoreRatio: 0.45,
  evidenceMatchesPerSignal: 2,
  explanationReasonLimit: 3,
} as const);

export const CONCEPT_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  'vista Duomo': 16,
  'vista canale': 14,
  'vista iconica': 14,
  'spazio all’aperto': 11,
  conversazione: 12,
  'vino naturale': 13,
  'cocktail d’autore': 12,
  'alta cucina': 12,
  vegetariano: 13,
  musica: 9,
  design: 7,
  lavorare: 12,
  prenotazione: 6,
  tramonto: 9,
});
