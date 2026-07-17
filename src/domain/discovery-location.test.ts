import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import {
  ASSUMED_WALKING_SPEED_KMH,
  DUOMO_DISCOVERY_ORIGIN,
  WALKING_DISTANCE_FACTOR,
  buildSessionTravelEstimates,
  estimateSessionWalk,
  haversineDistanceKm,
  isWithinMilanDiscoveryArea,
} from './discovery-location';

describe('geolocalizzazione foreground di discovery', () => {
  it('calcola Haversine in modo deterministico e documenta la stima pedonale', () => {
    const samePoint = haversineDistanceKm(DUOMO_DISCOVERY_ORIGIN, DUOMO_DISCOVERY_ORIGIN);
    const brera = haversineDistanceKm(DUOMO_DISCOVERY_ORIGIN, venues[0].discoveryLocation);
    const estimate = estimateSessionWalk(DUOMO_DISCOVERY_ORIGIN, venues[0].discoveryLocation);

    expect(samePoint).toBe(0);
    expect(brera).toBeGreaterThan(0.8);
    expect(brera).toBeLessThan(1);
    expect(estimate.estimatedWalkingKm).toBeCloseTo(estimate.straightLineKm * WALKING_DISTANCE_FACTOR, 2);
    expect(estimate.minutes).toBe(Math.max(1, Math.round((estimate.estimatedWalkingKm / ASSUMED_WALKING_SPEED_KMH) * 60)));
    expect(estimate).toMatchObject({ kind: 'session-estimate', mode: 'walk', disclosure: 'stimata, non routing' });
    expect(Object.isFrozen(estimate)).toBe(true);
  });

  it('accetta soltanto coordinate finite nell’area di Milano', () => {
    expect(isWithinMilanDiscoveryArea(DUOMO_DISCOVERY_ORIGIN)).toBe(true);
    expect(isWithinMilanDiscoveryArea({ latitude: Number.NaN, longitude: 9.19 })).toBe(false);
    expect(isWithinMilanDiscoveryArea({ latitude: 41.9028, longitude: 12.4964 })).toBe(false);
    expect(() => estimateSessionWalk(
      { latitude: 41.9028, longitude: 12.4964 },
      venues[0].discoveryLocation,
    )).toThrow(/Milano/);
  });

  it('produce una mappa effimera per tutte le fixture senza mutare catalogo o provenance', () => {
    const before = structuredClone(venues);
    const travelReference = venues[0].travelEstimate;
    const provenanceReference = venues[0].provenance;
    const estimates = buildSessionTravelEstimates(venues, { latitude: 45.476, longitude: 9.205 });

    expect(Object.keys(estimates)).toHaveLength(venues.length);
    expect(Object.values(estimates).every(({ disclosure }) => disclosure === 'stimata, non routing')).toBe(true);
    expect(Object.isFrozen(estimates)).toBe(true);
    expect(venues).toEqual(before);
    expect(venues[0].travelEstimate).toBe(travelReference);
    expect(venues[0].provenance).toBe(provenanceReference);
  });

  it('mantiene discoveryLocation esplicita su tutte le fixture e separata dal payload di pubblicazione', () => {
    expect(venues).toHaveLength(20);
    expect(venues.every(({ discoveryLocation }) => isWithinMilanDiscoveryArea(discoveryLocation))).toBe(true);
    expect(venues.every(({ discoveryLocation, publication }) => discoveryLocation !== publication?.geo)).toBe(true);
  });
});
