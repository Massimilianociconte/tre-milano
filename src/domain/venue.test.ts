import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import {
  getVenueCatalogStatus,
  hasFreshVenueVerification,
  hasUsableOpenStatus,
  hasUsableTravelEstimate,
  isVenueAvailableAt,
  isVenuePublishable,
  isVenueRecommendationEligible,
} from './venue';

describe('freschezza dello stato di apertura', () => {
  it('accetta lo snapshot soltanto come fixture dichiarata nel prototipo', () => {
    expect(hasUsableOpenStatus(venues[0], Date.parse('2030-01-01T00:00:00Z'))).toBe(true);
    expect(hasUsableOpenStatus({ ...venues[0], fixtureOnly: false }, Date.parse('2026-07-16T18:00:00+02:00'))).toBe(false);
    expect(isVenueRecommendationEligible(venues[0], Date.parse('2030-01-01T00:00:00Z'), 'fixture-preview')).toBe(true);
    expect(isVenueRecommendationEligible(venues[0], Date.parse('2026-07-16T18:00:00+02:00'), 'production')).toBe(false);
  });

  it('valuta verifiedAt come data editoriale di Milano, senza falsi futuri prima delle 02:00', () => {
    expect(hasFreshVenueVerification(venues[0], Date.parse('2026-07-16T00:15:00+02:00'))).toBe(true);
  });

  it('accetta un dato Gold soltanto con fonte HTTPS e finestra temporale valida', () => {
    const official = {
      ...venues[0],
      fixtureOnly: false,
      openStatus: {
        value: true,
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-07-17T02:00:00+02:00',
        source: 'official' as const,
        sourceUrl: 'https://lume-brera.it/orari',
      },
    };
    expect(hasUsableOpenStatus(official, Date.parse('2026-07-16T22:00:00+02:00'))).toBe(true);
    expect(hasUsableOpenStatus(official, Date.parse('2026-07-17T02:01:00+02:00'))).toBe(false);
  });

  it('valuta le finestre settimanali, incluse quelle oltre mezzanotte', () => {
    expect(isVenueAvailableAt(venues[0], 4, 22 * 60 + 30)).toBe(true);
    expect(isVenueAvailableAt(venues[0], 5, 60)).toBe(true);
    expect(isVenueAvailableAt(venues[0], 4, 12 * 60)).toBe(false);
  });

  it('non accetta in Gold un tempo globale senza origine e fonte verificabile', () => {
    const at = Date.parse('2026-07-16T20:00:00+02:00');
    expect(hasUsableTravelEstimate(venues[0], at)).toBe(true);
    expect(hasUsableTravelEstimate({ ...venues[0], fixtureOnly: false }, at)).toBe(false);
  });

  it('riserva il podio ai tier Gold/Platinum anche se un flag Bronze viene impostato per errore', () => {
    const inconsistent = { ...venues[0], maturityTier: 'Bronze' as const, recommendationEligible: true };
    expect(isVenueRecommendationEligible(inconsistent, Date.parse('2026-07-16T20:00:00+02:00'))).toBe(false);
    expect(getVenueCatalogStatus(inconsistent).value).toBe('explore-only');
  });

  it('mantiene ogni fixture non pubblicabile anche con un payload publication apparentemente completo', () => {
    const fixtureWithPublication = {
      ...venues[0],
      publication: {
        officialUrl: 'https://lume-brera.it/',
        schemaType: 'BarOrPub' as const,
        address: {
          streetAddress: 'Via Brera 1',
          postalCode: '20121',
          addressLocality: 'Milano' as const,
          addressRegion: 'MI' as const,
          addressCountry: 'IT' as const,
        },
        openingHours: ['Mo-Su 18:00-02:00'],
      },
    };
    expect(isVenuePublishable(fixtureWithPublication, Date.parse('2026-07-16T20:00:00+02:00'))).toBe(false);
    expect(getVenueCatalogStatus(fixtureWithPublication).value).toBe('fixture-recommendation-preview');
  });
});
