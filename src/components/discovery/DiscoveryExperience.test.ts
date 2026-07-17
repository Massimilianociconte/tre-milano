import { describe, expect, it } from 'vitest';
import { parseIntent } from '../../ranking/rank';
import {
  buildIntentChips,
  buildIntentRemovalOverrides,
  getLocalSuggestions,
} from './intent-ui';

describe('DiscoveryExperience intent UI', () => {
  it('deriva chip sintetici e rimovibili senza perdere le negazioni', () => {
    const intent = parseIntent('cocktail bar a Brera sotto 40 euro entro 15 minuti stasera tranquillo senza rooftop');
    const ids = buildIntentChips(intent).map(({ id }) => id);

    expect(ids).toEqual(expect.arrayContaining([
      'category:Cocktail bar',
      'neighborhood:Brera',
      'budget:max',
      'minutes:max',
      'time:service',
      'mood:tranquillo',
      'exclude:category:Rooftop',
    ]));
  });

  it('converte le rimozioni in override espliciti senza alterare la query raw', () => {
    const intent = parseIntent('cocktail bar a Brera sotto 40 euro tranquillo senza rooftop');
    const overrides = buildIntentRemovalOverrides(intent, new Set([
      'category:Cocktail bar',
      'budget:max',
      'mood:tranquillo',
      'exclude:category:Rooftop',
    ]));

    expect(overrides.categories).toEqual([]);
    expect(overrides.requiredCategories).toEqual([]);
    expect(overrides.excludedCategories).toEqual([]);
    expect(overrides.maxSpend).toBeUndefined();
    expect(overrides.atmosphere).toEqual([]);
    expect(intent.query).toContain('cocktail bar');
  });

  it('offre suggerimenti solo dalla tassonomia locale, limitati e deterministici', () => {
    const suggestions = getLocalSuggestions('Brera');
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(6);
    expect(suggestions.some(({ value }) => value === 'aperitivo a Brera')).toBe(true);
    expect(new Set(suggestions.map(({ id }) => id)).size).toBe(suggestions.length);
  });
});
