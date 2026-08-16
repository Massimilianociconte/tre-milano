import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import {
  TASTE_PROFILE_VERSION,
  TASTE_PROFILE_STORAGE_KEY,
  TASTE_PROFILE_WEIGHTS,
  createEmptyTasteProfile,
  parseTasteProfile,
  persistTasteProfile,
  tasteProfileAffinity,
  tasteProfileSemanticHints,
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

describe('affinità deterministica e ponderata', () => {
  const lume = venues.find((venue) => venue.id === 'lume-brera')!;
  const quota = venues.find((venue) => venue.id === 'quota-ventuno')!;

  it('scala l’intensità dello slider: estremo > lieve', () => {
    // lume è chiaramente tranquillo/intimo: asse energia a sinistra
    const mild: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: { energy: 1 }, // soffusa, intensità 0.5
    };
    const strong: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: { energy: 0 }, // tranquilla, intensità 1
    };

    const mildScore = tasteProfileAffinity(lume, mild).score;
    const strongScore = tasteProfileAffinity(lume, strong).score;

    expect(strongScore).toBeGreaterThan(mildScore);
    expect(strongScore).toBeGreaterThan(0);
    expect(strongScore).toBeLessThanOrEqual(TASTE_PROFILE_WEIGHTS.totalCap);
  });

  it('è deterministico e monotono sullo stesso input', () => {
    const profile: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: { atmosphere: 4, energy: 1, budget: 2 },
      interests: ['Cocktail bar', 'Brera'],
    };

    const a = tasteProfileAffinity(lume, profile);
    const b = tasteProfileAffinity(lume, profile);

    expect(a).toEqual(b);
    expect(a.score).toBeGreaterThan(0);
    expect(a.matches).toEqual(expect.arrayContaining(['Cocktail bar', 'Brera']));
  });

  it('premia gli interessi espliciti e il match di categoria', () => {
    const profile: TasteProfile = {
      ...createEmptyTasteProfile(),
      interests: ['Rooftop', 'Vista Duomo'],
    };

    const rooftopScore = tasteProfileAffinity(quota, profile).score;
    const cocktailScore = tasteProfileAffinity(lume, profile).score;

    expect(rooftopScore).toBeGreaterThan(cocktailScore);
    expect(tasteProfileAffinity(quota, profile).matches).toEqual(
      expect.arrayContaining(['Rooftop']),
    );
  });

  it('applica una leggera penalità se il locale è all’opposto dell’asse', () => {
    // lume è intimo/tranquillo: energia vivace dovrebbe scoraggiare
    const lively: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: { energy: 4 },
    };
    const calm: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: { energy: 0 },
    };

    const livelyOnQuiet = tasteProfileAffinity(lume, lively).score;
    const calmOnQuiet = tasteProfileAffinity(lume, calm).score;

    expect(calmOnQuiet).toBeGreaterThan(livelyOnQuiet);
  });

  it('restituisce hint semantici solo dalle preferenze dichiarate', () => {
    const profile: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: { atmosphere: 4, budget: 1 },
      interests: ['Design'],
    };

    expect(tasteProfileSemanticHints(profile)).toEqual(
      expect.arrayContaining(['design', 'esclusiva', '€€']),
    );
    expect(tasteProfileSemanticHints(createEmptyTasteProfile())).toEqual([]);
  });

  it('non supera mai il cap del contributo profilo', () => {
    const maximal: TasteProfile = {
      ...createEmptyTasteProfile(),
      preferences: {
        atmosphere: 4,
        energy: 4,
        experimentation: 4,
        sociality: 4,
        budget: 3,
      },
      interests: [...(['Rooftop', 'Cocktail bar', 'Ristoranti', 'Design', 'Aperitivo', 'Vista Duomo', 'Brera', 'Musica live'] as const)],
    };

    const score = tasteProfileAffinity(quota, maximal).score;
    expect(score).toBeLessThanOrEqual(TASTE_PROFILE_WEIGHTS.totalCap);
    expect(score).toBeGreaterThan(0);
  });
});
