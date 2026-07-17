import { describe, expect, it } from 'vitest';
import type { CatalogVenueSummary } from '../../domain/catalog-api';
import { rankVenues } from '../../ranking/rank';
import {
  buildCatalogCandidateRequestUrl,
  catalogLocalVisualFor,
  catalogPayloadToVenues,
  catalogSummaryToVenue,
  parseCatalogVenuePayload,
} from './catalog-venue-adapter';

const GENERATED_AT = '2026-07-17T10:00:00.000Z';

function summary(overrides: Partial<CatalogVenueSummary> = {}): CatalogVenueSummary {
  return {
    id: '45bb58b8-66a4-4a9b-a6ee-28296e589a68',
    slug: 'locale-reale-brera',
    name: 'Locale Reale Brera',
    shortDescription: 'Aperitivo elegante con cocktail d’autore e tavoli tranquilli.',
    category: { slug: 'cocktail-bar', name: 'Cocktail bar' },
    subcategorySlug: null,
    neighborhood: { slug: 'brera', name: 'Brera' },
    municipality: 1,
    location: { latitude: 45.4719, longitude: 9.1881 },
    formattedAddress: 'Via Brera 1, Milano',
    price: { level: 3, averageSpendCents: 3_800, currency: 'EUR' },
    ratings: [],
    primaryImage: { url: 'https://images.example.org/venue.webp', alt: 'Foto remota' },
    services: ['tavoli-esterni', 'prenotazione'],
    verification: {
      maturity: 'gold',
      qualityScore: 86,
      confidenceScore: 0.91,
      verifiedAt: '2026-07-16T08:00:00.000Z',
    },
    distanceMeters: null,
    ...overrides,
  };
}

describe('catalog venue adapter', () => {
  it('valida il payload, conserva le righe valide e scarta quelle malformate', () => {
    const parsed = parseCatalogVenuePayload({
      version: 'tre-catalog-v1',
      data: [summary(), { slug: 'rotto' }],
      pagination: { nextCursor: null, limit: 50, hasMore: false },
      meta: { sort: 'quality', generatedAt: GENERATED_AT },
    });

    expect(parsed?.summaries).toHaveLength(1);
    expect(parsed?.generatedAt).toBe(GENERATED_AT);
    expect(parseCatalogVenuePayload({ version: 'altra', data: [], meta: { generatedAt: GENERATED_AT } })).toBeNull();
  });

  it('ammette solo Gold/Platinum controllati e usa un asset locale per immagini remote', () => {
    const mapped = catalogSummaryToVenue(summary(), GENERATED_AT, 'https://tre.example');
    expect(mapped).toMatchObject({
      fixtureOnly: false,
      recommendationEligible: true,
      maturityTier: 'Gold',
      image: '/images/venue-cocktail.webp',
      averageSpend: 38,
      pricingKnown: true,
      catalogApiRankingEvidence: {
        source: 'catalog-api',
        travelDisclosure: 'stimata, non routing',
      },
    });
    expect(mapped?.image).not.toContain('images.example.org');
    expect(catalogSummaryToVenue(summary({
      verification: { ...summary().verification, maturity: 'silver' },
    }), GENERATED_AT)).toBeNull();
  });

  it('non stima un prezzo assente e applica i vincoli budget in modo conservativo', () => {
    const mapped = catalogSummaryToVenue(summary({
      price: { level: null, averageSpendCents: null, currency: 'EUR' },
    }), GENERATED_AT, 'https://tre.example');
    const referenceDate = new Date('2026-07-17T12:00:00.000Z');

    expect(mapped).toMatchObject({ pricingKnown: false, averageSpend: 0 });
    expect(rankVenues('aperitivo elegante', undefined, mapped ? [mapped] : [], {}, null, referenceDate)).toHaveLength(1);
    expect(rankVenues('aperitivo sotto 50 euro', undefined, mapped ? [mapped] : [], {}, null, referenceDate)).toEqual([]);
  });

  it('costruisce il refetch candidati soltanto da categorie e quartieri controllati', () => {
    const request = buildCatalogCandidateRequestUrl(
      'https://tre.example/cerca/',
      ['Cocktail bar', 'Rooftop', 'categoria non valida'],
      ['Porta Romana', 'Brera', '../non-valido'],
    );

    expect(request?.origin).toBe('https://tre.example');
    expect(request?.pathname).toBe('/api/catalog');
    expect(request?.searchParams.get('limit')).toBe('50');
    expect(request?.searchParams.get('sort')).toBe('quality');
    expect(request?.searchParams.getAll('category')).toEqual(['cocktail-bar', 'rooftop']);
    expect(request?.searchParams.getAll('neighborhood')).toEqual(['porta-romana', 'brera']);
    expect(request?.searchParams.has('q')).toBe(false);
    expect(buildCatalogCandidateRequestUrl('https://tre.example', [], [])).toBeNull();
  });

  it('espone le dimensioni reali della hero locale', () => {
    expect(catalogLocalVisualFor('Rooftop', 'rooftop', 'Rooftop Milano')).toMatchObject({
      path: '/images/hero-milano.webp',
      width: 1672,
      height: 941,
    });
  });

  it('accetta un’immagine soltanto quando è same-origin e nella allowlist locale', () => {
    const mapped = catalogSummaryToVenue(summary({
      primaryImage: {
        url: 'https://tre.example/images/venue-navigli.webp',
        alt: 'Immagine locale autorizzata',
      },
    }), GENERATED_AT, 'https://tre.example');

    expect(mapped?.image).toBe('/images/venue-navigli.webp');
    expect(mapped?.imageAlt).toBe('Immagine locale autorizzata');
  });

  it('consegna i record API reali al ranker deterministico senza inventare apertura e orari', () => {
    const summaries = [
      summary(),
      summary({
        id: 'ac2d92ca-eaf9-46a3-aa35-72f698324d4f',
        slug: 'locale-reale-navigli',
        name: 'Locale Reale Navigli',
        neighborhood: { slug: 'navigli', name: 'Navigli' },
        location: { latitude: 45.4515, longitude: 9.1748 },
      }),
      summary({
        id: 'c2377464-c960-490b-a8b3-d43923e78a26',
        slug: 'locale-reale-porta-romana',
        name: 'Locale Reale Porta Romana',
        neighborhood: { slug: 'porta-romana', name: 'Porta Romana' },
        location: { latitude: 45.4523, longitude: 9.2019 },
      }),
    ];
    const venues = catalogPayloadToVenues({ generatedAt: GENERATED_AT, summaries }, 'https://tre.example');
    const referenceDate = new Date('2026-07-17T12:00:00.000Z');

    expect(rankVenues('aperitivo elegante', undefined, venues, {}, null, referenceDate)).toHaveLength(3);
    expect(rankVenues('aperto ora', undefined, venues, {}, null, referenceDate)).toEqual([]);
  });
});
