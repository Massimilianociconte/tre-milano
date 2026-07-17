import { describe, expect, it } from 'vitest';
import { parseCatalogDetailResponse } from './catalog-detail';

function payload() {
  return {
    version: 'tre-catalog-v1',
    data: {
      id: '45bb58b8-66a4-4a9b-a6ee-28296e589a68',
      slug: 'ristorante-cracco',
      name: 'Ristorante Cracco',
      officialName: 'Cracco in Galleria',
      description: 'Cucina italiana contemporanea nel centro di Milano.',
      shortDescription: 'Alta cucina in Galleria.',
      category: { slug: 'ristorante', name: 'Ristorante' },
      subcategory: null,
      status: 'active',
      verification: {
        status: 'verified',
        maturity: 'gold',
        qualityScore: 92,
        completenessScore: 88,
        confidenceScore: 0.94,
        verifiedAt: '2026-07-17T08:30:00.000Z',
        staleAfter: '2026-09-17T08:30:00.000Z',
      },
      address: {
        formatted: 'Galleria Vittorio Emanuele II, Milano',
        streetName: 'Galleria Vittorio Emanuele II',
        streetNumber: null,
        postalCode: '20121',
        locality: 'Milano',
        municipality: 1,
        neighborhood: { slug: 'duomo', name: 'Duomo' },
        latitude: 45.4657,
        longitude: 9.1896,
      },
      price: {
        currency: 'EUR',
        level: 4,
        averageSpendCents: 18_000,
        minimumSpendCents: 12_000,
        maximumSpendCents: 25_000,
        note: 'Prezzo medio indicativo.',
        verifiedAt: '2026-07-17T08:30:00.000Z',
        validUntil: '2026-09-17T08:30:00.000Z',
      },
      contacts: [
        { kind: 'website', value: 'https://www.ristorantecracco.it/', official: true, primary: true },
        { kind: 42, value: 'malformed', official: true, primary: false },
      ],
      weeklyHours: [
        { weekday: 1, sequence: 1, opensAt: '12:00:00', closesAt: '14:30:00', closesNextDay: false, closed: false },
        { weekday: 9, sequence: 1, opensAt: '12:00:00', closesAt: '14:30:00', closesNextDay: false, closed: false },
      ],
      hourExceptions: [],
      services: [{ slug: 'prenotazione', name: 'Prenotazione', details: null }],
      images: [{
        url: '/images/venue-ristorante.webp',
        alt: 'Visual editoriale della categoria ristorante',
        caption: 'Visual di categoria',
        width: 900,
        height: 1124,
        rights: 'owned',
        rightsHolder: 'TRE Milano',
        attribution: 'Asset editoriale',
      }],
      ratings: [{
        source: 'Fonte autorizzata',
        rating: 4.7,
        scale: 5,
        reviewCount: 120,
        observedAt: '2026-07-16T10:00:00.000Z',
        sourceUrl: 'https://source.example.test/venue',
      }],
      sources: [{
        name: 'Sito ufficiale',
        kind: 'official_website',
        url: 'https://www.ristorantecracco.it/',
        license: null,
        licenseUrl: null,
        attribution: null,
        lastObservedAt: '2026-07-17T08:30:00.000Z',
      }],
    },
  };
}

describe('catalog venue detail runtime boundary', () => {
  it('accetta il passaporto verificato e filtra soltanto le righe ripetute malformate', () => {
    const parsed = parseCatalogDetailResponse(payload());

    expect(parsed).toMatchObject({
      slug: 'ristorante-cracco',
      address: { neighborhood: { slug: 'duomo', name: 'Duomo' } },
      price: { averageSpendCents: 18_000 },
    });
    expect(parsed?.contacts).toHaveLength(1);
    expect(parsed?.weeklyHours).toHaveLength(1);
    expect(parsed?.services).toEqual([{ slug: 'prenotazione', name: 'Prenotazione' }]);
  });

  it('accetta un prezzo assente senza trasformarlo in una stima', () => {
    const candidate = payload();
    candidate.data.price = null as never;

    expect(parseCatalogDetailResponse(candidate)?.price).toBeNull();
  });

  it('rifiuta identità, contratto e geografia principali non validi', () => {
    const wrongVersion = payload();
    wrongVersion.version = 'legacy';
    expect(parseCatalogDetailResponse(wrongVersion)).toBeNull();

    const wrongSlug = payload();
    wrongSlug.data.slug = '../cracco';
    expect(parseCatalogDetailResponse(wrongSlug)).toBeNull();

    const wrongGeo = payload();
    wrongGeo.data.address.latitude = 41.9028;
    wrongGeo.data.address.longitude = 12.4964;
    expect(parseCatalogDetailResponse(wrongGeo)).toBeNull();
  });
});
