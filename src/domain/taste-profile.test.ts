import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import {
  TASTE_PROFILE_VERSION,
  TASTE_PROFILE_STORAGE_KEY,
  createEmptyTasteProfile,
  parseTasteProfile,
  persistTasteProfile,
  tasteProfileAffinity,
  tasteProfileSignalCount,
  type TasteProfile,
} from './taste-profile';

describe('profilo di gusto versionato', () => {
  it('non trasforma i vecchi valori neutri in preferenze dichiarate', () => {
    const migrated = parseTasteProfile(JSON.stringify({
      preferences: {
        atmosphere: 2,
        energy: 4,
        experimentation: 2,
        sociality: 2,
        budget: 2,
      },
      interests: ['Brera', 'Dato non consentito'],
    }));

    expect(migrated).toEqual({
      version: TASTE_PROFILE_VERSION,
      state: 'active',
      preferences: { energy: 4 },
      interests: ['Brera'],
    });
    expect(tasteProfileSignalCount(migrated)).toBe(2);
  });

  it('un profilo vuoto o con versione futura non produce segnali', () => {
    const empty = createEmptyTasteProfile();

    expect(tasteProfileAffinity(venues[0], empty)).toEqual({ score: 0, matches: [] });
    expect(parseTasteProfile(JSON.stringify({ version: 2, state: 'active', preferences: {}, interests: [] }))).toBeNull();
  });

  it('non usa una fascia segnaposto quando il prezzo del locale non è noto', () => {
    const budgetProfile: TasteProfile = {
      ...createEmptyTasteProfile(),
      state: 'active',
      preferences: { budget: 1 },
    };
    const unknownPriceVenue = { ...venues[0], pricingKnown: false, priceLevel: 2 as const, averageSpend: 0 };

    expect(tasteProfileAffinity(unknownPriceVenue, budgetProfile)).toEqual({ score: 0, matches: [] });
  });

  it('persiste subito un payload canonico e compatto', () => {
    const writes: Array<[string, string]> = [];
    const profile: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: { energy: 4 },
      interests: ['Brera'],
    };

    const payload = persistTasteProfile({
      setItem(key, value) {
        writes.push([key, value]);
      },
    }, profile);

    expect(writes).toEqual([[TASTE_PROFILE_STORAGE_KEY, payload]]);
    expect(payload).toBe('{"version":1,"state":"active","preferences":{"energy":4},"interests":["Brera"]}');
    expect(parseTasteProfile(payload)).toEqual(profile);
  });
});
