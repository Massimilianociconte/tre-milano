import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import {
  FIXTURE_CATALOG_EXPECTED_COUNT,
  assertProductionCatalog,
  validateCatalogStructure,
  validateFixtureCatalog,
  validateProductionCatalog,
} from './catalog-validation';
import type { Venue } from './venue';
import { getVerifiedVenuePublicationActions } from './venue';

const validationTime = Date.parse('2026-07-16T20:00:00+02:00');

function goldVenue(): Venue {
  return {
    ...venues[0],
    fixtureOnly: false,
    verifiedAt: '2026-07-16',
    openStatus: {
      value: true,
      checkedAt: '2026-07-16T18:00:00+02:00',
      validUntil: '2026-07-17T02:00:00+02:00',
      source: 'official',
      sourceUrl: 'https://lume-brera.it/orari',
    },
    availability: {
      ...venues[0].availability,
      checkedAt: '2026-07-16T18:00:00+02:00',
      validUntil: '2026-08-16T18:00:00+02:00',
      source: 'official',
      sourceUrl: 'https://lume-brera.it/orari',
    },
    travelEstimate: {
      minutes: 8,
      mode: 'walk',
      origin: {
        id: 'milano-duomo-centroid',
        label: 'Duomo, centroide editoriale',
        shortLabel: 'Duomo',
        latitude: 45.4642,
        longitude: 9.19,
      },
      checkedAt: '2026-07-16T18:00:00+02:00',
      validUntil: '2026-07-17T18:00:00+02:00',
      source: 'routing',
      sourceUrl: 'https://routing.tre-milano.it/walk/duomo/lume-brera',
    },
    provenance: {
      pricing: {
        source: 'official',
        sourceUrl: 'https://lume-brera.it/menu',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-10-01T18:00:00+02:00',
        confidence: 1,
      },
      attributes: {
        source: 'editorial',
        sourceUrl: 'https://tre-milano.it/fonti/lume-brera',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-10-01T18:00:00+02:00',
        confidence: 0.95,
      },
      imageRights: {
        source: 'editorial',
        sourceUrl: 'https://tre-milano.it/licenze/lume-brera',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-10-01T18:00:00+02:00',
        confidence: 1,
        rightsStatus: 'licensed',
        rightsHolder: 'Fotografo di prova',
      },
    },
    publication: {
      officialUrl: 'https://lume-brera.it/',
      schemaType: 'BarOrPub',
      address: {
        streetAddress: 'Via Brera 1',
        postalCode: '20121',
        addressLocality: 'Milano',
        addressRegion: 'MI',
        addressCountry: 'IT',
      },
      geo: { latitude: 45.47, longitude: 9.18 },
      openingHours: ['Mo-Su 18:00-02:00'],
    },
  };
}

const actionProvenance = (sourceUrl: string) => ({
  source: 'official' as const,
  sourceUrl,
  checkedAt: '2026-07-16T18:00:00+02:00',
  validUntil: '2026-08-16T18:00:00+02:00',
  confidence: 1,
});

function goldVenueWithActions(): Venue {
  const venue = goldVenue();
  return {
    ...venue,
    publication: {
      ...venue.publication!,
      telephone: '+390212345678',
      actions: {
        official: {
          url: venue.publication!.officialUrl,
          provenance: actionProvenance(venue.publication!.officialUrl),
        },
        menu: {
          url: 'https://lume-brera.it/menu',
          provenance: actionProvenance('https://lume-brera.it/menu'),
        },
        reservation: {
          url: 'https://booking.lume-brera.it/tavolo',
          provenance: actionProvenance('https://lume-brera.it/prenota'),
        },
        telephone: {
          telephone: '+390212345678',
          provenance: actionProvenance('https://lume-brera.it/contatti'),
        },
        directions: {
          destination: { ...venue.publication!.geo! },
          provenance: actionProvenance('https://lume-brera.it/contatti'),
        },
      },
    },
  };
}

describe('gate catalogo production + gold', () => {
  it('valida il catalogo fixture a 20 venue con tutti i tier e una baseline raccomandabile stabile', () => {
    const counts = venues.reduce<Record<string, number>>((accumulator, venue) => {
      accumulator[venue.maturityTier] = (accumulator[venue.maturityTier] ?? 0) + 1;
      return accumulator;
    }, {});

    expect(venues).toHaveLength(FIXTURE_CATALOG_EXPECTED_COUNT);
    expect(counts).toEqual({ Platinum: 2, Gold: 4, Silver: 7, Bronze: 7 });
    expect(venues.filter(({ recommendationEligible }) => recommendationEligible)).toHaveLength(6);
    expect(venues.filter(({ recommendationEligible }) => !recommendationEligible)).toHaveLength(14);
    expect(validateFixtureCatalog(venues)).toEqual([]);
  });

  it('rifiuta count fixture incompleto e incoerenze tier/eligibility', () => {
    const incomplete = validateFixtureCatalog(venues.slice(0, -1)).map(({ code }) => code);
    const bronzeEligible: Venue = {
      ...venues.find(({ maturityTier }) => maturityTier === 'Bronze')!,
      recommendationEligible: true,
    };
    const inconsistent = validateCatalogStructure([bronzeEligible]).map(({ code }) => code);

    expect(incomplete).toContain('FIXTURE_CATALOG_SIZE');
    expect(inconsistent).toContain('INCONSISTENT_MATURITY_ELIGIBILITY');
  });

  it('rifiuta un tier sconosciuto anche quando arriva da un payload runtime non tipizzato', () => {
    const unknownTier = { ...venues[0], maturityTier: 'Diamond' } as unknown as Venue;
    expect(validateCatalogStructure([unknownTier]).map(({ code }) => code)).toContain('INVALID_MATURITY_TIER');
  });

  it('rifiuta una discoveryLocation assente o fuori Milano senza riusare publication.geo', () => {
    const invalid = {
      ...goldVenue(),
      discoveryLocation: { latitude: 0, longitude: 0 },
    };
    expect(validateCatalogStructure([invalid]).map(({ code }) => code)).toContain('INVALID_DISCOVERY_LOCATION');
    expect(invalid.discoveryLocation).not.toBe(invalid.publication?.geo);
  });

  it('accetta solo venue raccomandabili con pubblicazione e provenance valide', () => {
    expect(validateProductionCatalog([goldVenue()], validationTime)).toEqual([]);
  });

  it('ammette ogni CTA soltanto con valore coerente e provenance fresca', () => {
    const venue = goldVenueWithActions();
    expect(validateProductionCatalog([venue], validationTime)).toEqual([]);
    expect(Object.keys(getVerifiedVenuePublicationActions(venue, validationTime))).toEqual([
      'official',
      'menu',
      'reservation',
      'telephone',
      'directions',
    ]);
  });

  it('rifiuta URL operativi non HTTPS, riservati o incoerenti con officialUrl', () => {
    const invalid = goldVenueWithActions();
    invalid.publication!.actions!.official!.url = 'https://10.0.0.1/';
    invalid.publication!.actions!.menu!.url = 'http://lume-brera.it/menu';
    invalid.publication!.actions!.reservation!.url = 'https://example.org/prenota';
    const codes = validateProductionCatalog([invalid], validationTime).map(({ code }) => code);

    expect(codes).toEqual(expect.arrayContaining(['INVALID_ACTION_URL', 'NOT_PUBLISHABLE']));
    expect(getVerifiedVenuePublicationActions(invalid, validationTime)).toEqual({});
  });

  it('rifiuta URL locali, literal IP e hostname con root dot nel gate editoriale', () => {
    for (const unsafeUrl of [
      'https://localhost./',
      'https://foo.local./',
      'https://[fc00::1]/',
      'https://[fe80::1]/',
      'https://[::ffff:127.0.0.1]/',
      'https://127.0.0.1/',
      'https://192.168.1.1/',
      'https://example.com:8443/',
    ]) {
      const venue = goldVenueWithActions();
      venue.publication!.officialUrl = unsafeUrl;
      venue.publication!.actions!.official!.url = unsafeUrl;
      expect(validateProductionCatalog([venue], validationTime).map(({ code }) => code))
        .toEqual(expect.arrayContaining(['INVALID_OFFICIAL_URL', 'INVALID_ACTION_URL', 'NOT_PUBLISHABLE']));
    }
  });

  it('rifiuta telefono mancante, malformato o diverso dal dato publication', () => {
    const missingPublicationPhone = goldVenueWithActions();
    delete missingPublicationPhone.publication!.telephone;
    const malformedActionPhone = goldVenueWithActions();
    malformedActionPhone.publication!.actions!.telephone!.telephone = '02 12345678';
    const malformedPublicationPhone = goldVenueWithActions();
    malformedPublicationPhone.publication!.telephone = '0212345678';

    expect(validateProductionCatalog([missingPublicationPhone], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INCONSISTENT_ACTION_DATA', 'NOT_PUBLISHABLE']));
    expect(validateProductionCatalog([malformedActionPhone], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_ACTION_TELEPHONE', 'NOT_PUBLISHABLE']));
    expect(validateProductionCatalog([malformedPublicationPhone], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_TELEPHONE', 'INCONSISTENT_ACTION_DATA', 'NOT_PUBLISHABLE']));
  });

  it('rifiuta provenance assente, non pubblica, stantia o sotto confidence', () => {
    const missing = goldVenueWithActions() as Venue & { publication: NonNullable<Venue['publication']> };
    delete (missing.publication.actions!.menu! as { provenance?: unknown }).provenance;
    const privateSource = goldVenueWithActions();
    privateSource.publication!.actions!.reservation!.provenance.sourceUrl = 'https://localhost/prenota';
    const stale = goldVenueWithActions();
    stale.publication!.actions!.telephone!.provenance.validUntil = '2026-07-15T18:00:00+02:00';
    const weak = goldVenueWithActions();
    weak.publication!.actions!.directions!.provenance.confidence = 0.69;

    for (const invalid of [missing, privateSource, stale, weak]) {
      expect(validateProductionCatalog([invalid], validationTime).map(({ code }) => code))
        .toEqual(expect.arrayContaining(['INVALID_ACTION_PROVENANCE', 'NOT_PUBLISHABLE']));
      expect(getVerifiedVenuePublicationActions(invalid, validationTime)).toEqual({});
    }
  });

  it('rifiuta un blocco actions runtime nullo o con chiavi non previste', () => {
    const nullActions = goldVenue() as Venue & { publication: NonNullable<Venue['publication']> };
    nullActions.publication.actions = null as unknown as NonNullable<Venue['publication']>['actions'];
    const unknownAction = goldVenueWithActions() as Venue & { publication: NonNullable<Venue['publication']> };
    Object.assign(unknownAction.publication.actions!, { claim: { url: 'https://lume-brera.it/' } });

    expect(validateProductionCatalog([nullActions], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_ACTION_SHAPE', 'NOT_PUBLISHABLE']));
    expect(validateProductionCatalog([unknownAction], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_ACTION_SHAPE', 'NOT_PUBLISHABLE']));
  });

  it('rifiuta coordinate Naviga mancanti, fuori Milano o diverse da publication.geo', () => {
    const missingGeo = goldVenueWithActions();
    delete missingGeo.publication!.geo;
    const outside = goldVenueWithActions();
    outside.publication!.actions!.directions!.destination = { latitude: 0, longitude: 0 };
    const drifted = goldVenueWithActions();
    drifted.publication!.actions!.directions!.destination = { latitude: 45.48, longitude: 9.2 };

    expect(validateProductionCatalog([missingGeo], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_GEO', 'INCONSISTENT_ACTION_DATA', 'NOT_PUBLISHABLE']));
    expect(validateProductionCatalog([outside], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_ACTION_GEO', 'NOT_PUBLISHABLE']));
    expect(validateProductionCatalog([drifted], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INCONSISTENT_ACTION_DATA', 'NOT_PUBLISHABLE']));
  });

  it('non trasforma mai una fixture in CTA operative anche con un payload actions completo', () => {
    const fixture = { ...goldVenueWithActions(), fixtureOnly: true };
    expect(getVerifiedVenuePublicationActions(fixture, validationTime)).toEqual({});
    expect(validateFixtureCatalog([fixture]).map(({ code }) => code)).toEqual(['FIXTURE_CATALOG_SIZE']);
  });

  it('blocca esplicitamente le fixture senza affidarsi al testo del sorgente', () => {
    const issues = validateProductionCatalog([venues[0]], validationTime);
    expect(issues.some((issue) => issue.code === 'FIXTURE_DATA')).toBe(true);
    expect(() => assertProductionCatalog([venues[0]], validationTime)).toThrow(/catalogo contiene ancora venue fixture/);
  });

  it('rifiuta orari Schema.org e disponibilità settimanale malformati', () => {
    const valid = goldVenue();
    const malformed: Venue = {
      ...valid,
      availability: { ...valid.availability, weekly: { mon: [{ opens: '25:00', closes: '02:00' }] } },
      publication: { ...valid.publication!, openingHours: ['sempre aperto'] },
    };
    const codes = validateProductionCatalog([malformed], validationTime).map((issue) => issue.code);
    expect(codes).toContain('INVALID_WEEKLY_AVAILABILITY');
    expect(codes).toContain('INVALID_OPENING_HOURS');
  });

  it('rifiuta un tempo statico senza origine e provenance di routing', () => {
    const invalid: Venue = {
      ...goldVenue(),
      travelEstimate: { ...venues[0].travelEstimate },
    };
    const codes = validateProductionCatalog([invalid], validationTime).map((issue) => issue.code);
    expect(codes).toContain('INVALID_TRAVEL_PROVENANCE');
    expect(codes).toContain('NOT_PUBLISHABLE');
  });

  it('rifiuta host riservati, coordinate fuori Milano e provenance dei campi assente', () => {
    const valid = goldVenue();
    const invalid: Venue = {
      ...valid,
      publication: {
        ...valid.publication!,
        officialUrl: 'https://example.org/',
        geo: { latitude: 0, longitude: 0 },
      },
      provenance: { ...venues[0].provenance },
    };
    const codes = validateProductionCatalog([invalid], validationTime).map((issue) => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['INVALID_OFFICIAL_URL', 'INVALID_GEO', 'INVALID_FIELD_PROVENANCE', 'NOT_PUBLISHABLE']));
  });

  it('rifiuta valori core vuoti o economicamente impossibili anche con provenance valida', () => {
    const invalid: Venue = {
      ...goldVenue(),
      id: 'ID NON VALIDO',
      slug: 'Slug Non Valido',
      name: '',
      averageSpend: -10,
      image: '/images/inesistente.svg',
      atmosphere: [],
    };
    const codes = validateProductionCatalog([invalid], validationTime).map((issue) => issue.code);
    expect(codes).toContain('INVALID_CORE_FIELDS');
  });

  it('applica la confidence minima Gold 0,70 sia alla venue sia ai campi critici', () => {
    const threshold = goldVenue();
    threshold.confidence = 0.7;
    threshold.provenance.pricing.confidence = 0.7;
    threshold.provenance.attributes.confidence = 0.7;
    threshold.provenance.imageRights.confidence = 0.7;
    const aggregateBelowThreshold: Venue = { ...goldVenue(), confidence: 0.69 };
    const fieldBelowThreshold: Venue = {
      ...goldVenue(),
      provenance: {
        ...goldVenue().provenance,
        pricing: { ...goldVenue().provenance.pricing, confidence: 0.69 },
      },
    };

    expect(validateProductionCatalog([threshold], validationTime)).toEqual([]);
    expect(validateProductionCatalog([aggregateBelowThreshold], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_CONFIDENCE', 'NOT_PUBLISHABLE']));
    expect(validateProductionCatalog([fieldBelowThreshold], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_FIELD_PROVENANCE', 'NOT_PUBLISHABLE']));
  });

  it('rimuove la Gold eligibility quando verifica o provenance sono stantie', () => {
    const staleVerification: Venue = { ...goldVenue(), verifiedAt: '2026-01-01' };
    const staleProvenance: Venue = {
      ...goldVenue(),
      provenance: {
        ...goldVenue().provenance,
        attributes: {
          ...goldVenue().provenance.attributes,
          checkedAt: '2025-01-01T00:00:00+01:00',
          validUntil: '2025-02-01T00:00:00+01:00',
        },
      },
    };

    expect(validateProductionCatalog([staleVerification], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_VERIFICATION_DATE', 'NOT_PUBLISHABLE']));
    expect(validateProductionCatalog([staleProvenance], validationTime).map(({ code }) => code))
      .toEqual(expect.arrayContaining(['INVALID_FIELD_PROVENANCE', 'NOT_PUBLISHABLE']));
  });
});
