import { describe, expect, it } from 'vitest';
import {
  isVenueSaved,
  parseSavedVenues,
  savedVenueDetailHref,
  savedVenueFromVenue,
  toggleSavedVenue,
} from './favorites';
import { venues } from '@/data/venues';

const fixture = venues[0];

describe('favorites domain', () => {
  it('migra gli id legacy delle fixture in entry complete', () => {
    const parsed = parseSavedVenues([fixture.id, 'id-inesistente', 12, null]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      id: fixture.id,
      slug: fixture.slug,
      name: fixture.name,
      fixtureOnly: true,
    });
  });

  it('accetta entry catalogo e costruisce l’href corretto', () => {
    const catalog = savedVenueFromVenue({
      id: '19186f27-30e0-4142-b839-7a05c029c6ed',
      slug: 'armani-bamboo-bar',
      name: 'Armani/Bamboo Bar',
      category: 'Rooftop',
      neighborhood: 'Quadrilatero della moda',
      image: '/images/hero-milano.webp',
      imageAlt: 'Illustrazione rooftop',
      imageWidth: 1600,
      imageHeight: 900,
      fixtureOnly: false,
      averageSpend: 45,
      travelEstimate: {
        minutes: 12,
        mode: 'walk',
        origin: {
          id: 'milano-duomo-centroid',
          label: 'Duomo di Milano',
          shortLabel: 'Duomo',
          latitude: 45.4642,
          longitude: 9.19,
        },
        checkedAt: '2026-07-17T00:00:00.000Z',
        validUntil: '2026-07-18T00:00:00.000Z',
        source: 'editorial',
      },
      features: ['terrazza', 'musica live'],
    });

    expect(catalog.fixtureOnly).toBe(false);
    expect(savedVenueDetailHref(catalog)).toBe('/locale/?slug=armani-bamboo-bar');
    expect(savedVenueDetailHref({ fixtureOnly: true, slug: fixture.slug })).toBe(`/locali/${fixture.slug}/`);
  });

  it('toggle aggiunge e rimuove senza duplicati', () => {
    const first = toggleSavedVenue([], fixture);
    expect(first.saved).toBe(true);
    expect(first.items).toHaveLength(1);
    expect(isVenueSaved(first.items, fixture.id)).toBe(true);

    const again = toggleSavedVenue(first.items, fixture);
    expect(again.saved).toBe(false);
    expect(again.items).toHaveLength(0);

    const catalogVenue = {
      ...fixture,
      id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      slug: 'locale-catalogo',
      fixtureOnly: false,
    };
    const mixed = toggleSavedVenue(first.items, catalogVenue);
    expect(mixed.items).toHaveLength(2);
    expect(mixed.items.map((item) => item.id).sort()).toEqual(
      [fixture.id, catalogVenue.id].sort(),
    );
  });

  it('ignora entry malformate e mantiene un solo record per id', () => {
    const a = savedVenueFromVenue(fixture, '2026-01-01T00:00:00.000Z');
    const b = { ...a, name: 'Nome aggiornato', savedAt: '2026-07-01T00:00:00.000Z' };
    const parsed = parseSavedVenues([
      a,
      b,
      { id: 'x', slug: 'bad slug' },
      { ...a, slug: 'slug-ok-ma-id-troppo-lungo-'.repeat(10) },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Nome aggiornato');
  });
});
