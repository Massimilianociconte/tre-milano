import { describe, expect, it } from 'vitest';
import { createVenueDirectionsUrl } from './venue-action-links';

describe('link Naviga senza posizione utente', () => {
  it('usa il formato Directions URL documentato e include soltanto la destinazione verificata', () => {
    const result = new URL(createVenueDirectionsUrl({
      destination: { latitude: 45.47, longitude: 9.18 },
      provenance: {
        source: 'official',
        sourceUrl: 'https://lume-brera.it/contatti',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-08-16T18:00:00+02:00',
        confidence: 1,
      },
    }));

    expect(result.origin).toBe('https://www.google.com');
    expect(result.pathname).toBe('/maps/dir/');
    expect(result.searchParams.get('api')).toBe('1');
    expect(result.searchParams.get('destination')).toBe('45.47,9.18');
    expect(result.searchParams.get('travelmode')).toBe('walking');
    expect(result.searchParams.has('origin')).toBe(false);
    expect(result.searchParams.has('lat')).toBe(false);
    expect(result.searchParams.has('lng')).toBe(false);
  });

  it('rifiuta una destinazione fuori Milano prima di costruire il link esterno', () => {
    expect(() => createVenueDirectionsUrl({
      destination: { latitude: 0, longitude: 0 },
      provenance: {
        source: 'official',
        sourceUrl: 'https://lume-brera.it/contatti',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-08-16T18:00:00+02:00',
        confidence: 1,
      },
    })).toThrow(TypeError);
  });
});

