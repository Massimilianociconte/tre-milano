import { venues as catalogVenues } from '../../data/venues';
import type { SearchIntent } from '../../domain/venue';
import type { RankingOverrides } from '../../ranking/rank';

export type IntentChip = {
  id: string;
  label: string;
  hard: boolean;
};

export type LocalSuggestion = {
  id: string;
  label: string;
  value: string;
  kind: 'occasione' | 'categoria' | 'zona' | 'atmosfera' | 'caratteristica';
};

function normaliseUiText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('it-IT')
    .replace(/[^a-z0-9€]+/g, ' ')
    .trim();
}

function titleCaseItalian(value: string) {
  return value.replace(/(^|\s)\p{L}/gu, (letter) => letter.toLocaleUpperCase('it-IT'));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

const LOCAL_SUGGESTIONS: LocalSuggestion[] = (() => {
  const suggestions: Omit<LocalSuggestion, 'id'>[] = [
    { label: 'Aperitivo elegante', value: 'aperitivo elegante', kind: 'occasione' },
    { label: 'Cena romantica', value: 'cena romantica', kind: 'occasione' },
    { label: 'Rooftop con vista Duomo', value: 'rooftop con vista Duomo', kind: 'caratteristica' },
    { label: 'Cocktail bar tranquillo', value: 'cocktail bar tranquillo', kind: 'atmosfera' },
    ...uniqueStrings(catalogVenues.map(({ category }) => category)).map((category) => ({
      label: titleCaseItalian(category),
      value: category.toLocaleLowerCase('it-IT'),
      kind: 'categoria' as const,
    })),
    ...uniqueStrings(catalogVenues.map(({ neighborhood }) => neighborhood)).map((neighborhood) => ({
      label: `Aperitivo a ${neighborhood}`,
      value: `aperitivo a ${neighborhood}`,
      kind: 'zona' as const,
    })),
    ...uniqueStrings(catalogVenues.flatMap(({ atmosphere }) => atmosphere)).map((mood) => ({
      label: `Atmosfera ${mood}`,
      value: `locale ${mood}`,
      kind: 'atmosfera' as const,
    })),
    ...uniqueStrings(catalogVenues.flatMap(({ occasions }) => occasions)).map((occasion) => ({
      label: titleCaseItalian(occasion),
      value: occasion,
      kind: 'occasione' as const,
    })),
    ...uniqueStrings(catalogVenues.flatMap(({ features }) => features)).map((feature) => ({
      label: titleCaseItalian(feature),
      value: feature,
      kind: 'caratteristica' as const,
    })),
  ];
  const seen = new Set<string>();
  return suggestions
    .filter(({ value }) => {
      const key = normaliseUiText(value);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((suggestion, index) => ({ ...suggestion, id: `local-${index}` }));
})();

export function getLocalSuggestions(draft: string, limit = 6) {
  const tokens = normaliseUiText(draft).split(' ').filter(Boolean);
  if (!tokens.length) return [];
  return LOCAL_SUGGESTIONS
    .map((suggestion) => {
      const searchable = normaliseUiText(`${suggestion.label} ${suggestion.value} ${suggestion.kind}`);
      const matches = tokens.every((token) => searchable.includes(token));
      const startsWith = searchable.startsWith(tokens.join(' '));
      return { suggestion, matches, startsWith };
    })
    .filter(({ matches }) => matches)
    .sort((left, right) => Number(right.startsWith) - Number(left.startsWith) || left.suggestion.label.localeCompare(right.suggestion.label, 'it-IT'))
    .slice(0, limit)
    .map(({ suggestion }) => suggestion);
}

export function buildIntentChips(intent: SearchIntent, removedIds: ReadonlySet<string> = new Set()): IntentChip[] {
  const chips: IntentChip[] = [];
  const add = (id: string, label: string, hard: boolean) => {
    if (!removedIds.has(id) && !chips.some((chip) => chip.id === id)) chips.push({ id, label, hard });
  };

  for (const value of intent.categories) {
    add(`category:${value}`, `Categoria · ${titleCaseItalian(value)}`, intent.requiredCategories.includes(value));
  }
  for (const value of intent.neighborhoods) {
    add(`neighborhood:${value}`, `Zona · ${value}`, intent.requiredNeighborhoods.includes(value));
  }
  if (intent.minSpend !== undefined && intent.maxSpend !== undefined) {
    add('budget:range', `Budget · €${intent.minSpend}–€${intent.maxSpend}`, true);
  } else {
    if (intent.minSpend !== undefined) add('budget:min', `Da €${intent.minSpend}`, true);
    if (intent.maxSpend !== undefined) add('budget:max', `Fino a €${intent.maxSpend}`, true);
  }
  if (intent.maxMinutes !== undefined) {
    add('minutes:max', `Entro ${intent.maxMinutes} min${intent.travelOriginId ? ' da Duomo' : ''}`, true);
  }
  if (intent.requiresOpenNow) add('time:open-now', 'Aperto adesso', true);
  if (intent.requestedServiceTime) add('time:service', `Orario · ${intent.requestedServiceTime.label}`, true);
  for (const value of intent.atmosphere) {
    add(
      `mood:${value}`,
      `Mood · ${titleCaseItalian(value)}`,
      intent.requiredAtmosphere.includes(value) || intent.requiredAtmosphereAny.includes(value),
    );
  }
  for (const value of intent.occasions) add(`occasion:${value}`, `Occasione · ${titleCaseItalian(value)}`, false);
  for (const value of intent.concepts) add(`concept:${value}`, `Dettaglio · ${titleCaseItalian(value)}`, intent.requiredConcepts.includes(value));
  for (const value of intent.excludedCategories) add(`exclude:category:${value}`, `Esclude · ${titleCaseItalian(value)}`, true);
  for (const value of intent.excludedNeighborhoods) add(`exclude:neighborhood:${value}`, `Esclude · ${value}`, true);
  for (const value of intent.excludedAtmosphere) add(`exclude:mood:${value}`, `Esclude · ${titleCaseItalian(value)}`, true);
  for (const value of intent.excludedOccasions) add(`exclude:occasion:${value}`, `Esclude · ${titleCaseItalian(value)}`, true);
  for (const value of intent.excludedConcepts) add(`exclude:concept:${value}`, `Esclude · ${titleCaseItalian(value)}`, true);
  return chips;
}

export function buildIntentRemovalOverrides(intent: SearchIntent, removedIds: ReadonlySet<string>): RankingOverrides {
  if (!removedIds.size) return {};
  const removed = (id: string) => removedIds.has(id);
  const overrides: RankingOverrides = {};

  if ([...removedIds].some((id) => id.startsWith('category:') || id.startsWith('exclude:category:'))) {
    overrides.categories = intent.categories.filter((value) => !removed(`category:${value}`));
    overrides.requiredCategories = intent.requiredCategories.filter((value) => !removed(`category:${value}`));
    overrides.excludedCategories = intent.excludedCategories.filter((value) => !removed(`exclude:category:${value}`));
  }
  if ([...removedIds].some((id) => id.startsWith('neighborhood:') || id.startsWith('exclude:neighborhood:'))) {
    overrides.neighborhoods = intent.neighborhoods.filter((value) => !removed(`neighborhood:${value}`));
    overrides.requiredNeighborhoods = intent.requiredNeighborhoods.filter((value) => !removed(`neighborhood:${value}`));
    overrides.excludedNeighborhoods = intent.excludedNeighborhoods.filter((value) => !removed(`exclude:neighborhood:${value}`));
  }
  if (removed('budget:range') || removed('budget:min')) overrides.minSpend = undefined;
  if (removed('budget:range') || removed('budget:max')) overrides.maxSpend = undefined;
  if (removed('minutes:max')) {
    overrides.maxMinutes = undefined;
    overrides.travelOriginId = undefined;
  }
  if (removed('time:open-now')) overrides.requiresOpenNow = false;
  if (removed('time:service')) overrides.requestedServiceTime = undefined;
  if ([...removedIds].some((id) => id.startsWith('mood:') || id.startsWith('exclude:mood:'))) {
    overrides.atmosphere = intent.atmosphere.filter((value) => !removed(`mood:${value}`));
    overrides.requiredAtmosphere = intent.requiredAtmosphere.filter((value) => !removed(`mood:${value}`));
    overrides.requiredAtmosphereAny = intent.requiredAtmosphereAny.filter((value) => !removed(`mood:${value}`));
    overrides.excludedAtmosphere = intent.excludedAtmosphere.filter((value) => !removed(`exclude:mood:${value}`));
  }
  if ([...removedIds].some((id) => id.startsWith('occasion:') || id.startsWith('exclude:occasion:'))) {
    overrides.occasions = intent.occasions.filter((value) => !removed(`occasion:${value}`));
    overrides.occasion = overrides.occasions[0];
    overrides.excludedOccasions = intent.excludedOccasions.filter((value) => !removed(`exclude:occasion:${value}`));
  }
  if ([...removedIds].some((id) => id.startsWith('concept:') || id.startsWith('exclude:concept:'))) {
    overrides.concepts = intent.concepts.filter((value) => !removed(`concept:${value}`));
    overrides.requiredConcepts = intent.requiredConcepts.filter((value) => !removed(`concept:${value}`));
    overrides.excludedConcepts = intent.excludedConcepts.filter((value) => !removed(`exclude:concept:${value}`));
  }

  const removedTokens = new Set([...removedIds]
    .flatMap((id) => normaliseUiText(id.split(':').slice(-1)[0] ?? '').split(' '))
    .filter(Boolean));
  overrides.semanticTokens = intent.semanticTokens.filter((token) => !removedTokens.has(normaliseUiText(token)));
  return overrides;
}
