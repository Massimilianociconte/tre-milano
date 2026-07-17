import type { DiscoveryCoordinates, SessionTravelEstimate, Venue } from './venue';

export const DUOMO_DISCOVERY_ORIGIN: Readonly<DiscoveryCoordinates> = Object.freeze({
  latitude: 45.4642,
  longitude: 9.19,
});

export const MILAN_DISCOVERY_BOUNDS = Object.freeze({
  minLatitude: 45.35,
  maxLatitude: 45.58,
  minLongitude: 9.0,
  maxLongitude: 9.35,
});

export const WALKING_DISTANCE_FACTOR = 1.25;
export const ASSUMED_WALKING_SPEED_KMH = 4.8;
const EARTH_RADIUS_KM = 6371.0088;

export function isFiniteCoordinates(value: unknown): value is DiscoveryCoordinates {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DiscoveryCoordinates>;
  return Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude);
}

/** Conservative product boundary: foreground position must resolve inside greater Milan. */
export function isWithinMilanDiscoveryArea(value: unknown): value is DiscoveryCoordinates {
  if (!isFiniteCoordinates(value)) return false;
  return value.latitude >= MILAN_DISCOVERY_BOUNDS.minLatitude
    && value.latitude <= MILAN_DISCOVERY_BOUNDS.maxLatitude
    && value.longitude >= MILAN_DISCOVERY_BOUNDS.minLongitude
    && value.longitude <= MILAN_DISCOVERY_BOUNDS.maxLongitude;
}

function toRadians(value: number) {
  return value * Math.PI / 180;
}

/** Great-circle distance; it does not claim to follow the street network. */
export function haversineDistanceKm(origin: DiscoveryCoordinates, destination: DiscoveryCoordinates) {
  if (!isFiniteCoordinates(origin) || !isFiniteCoordinates(destination)) return Number.NaN;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(originLatitude) * Math.cos(destinationLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, haversine)));
}

/**
 * Session-only walking approximation: Haversine x 1.25 street-network factor,
 * divided by a documented 4.8 km/h walking speed. No external routing API is
 * called, so the UI must retain the `stimata, non routing` disclosure.
 */
export function estimateSessionWalk(
  origin: DiscoveryCoordinates,
  destination: DiscoveryCoordinates,
): SessionTravelEstimate {
  if (!isWithinMilanDiscoveryArea(origin) || !isWithinMilanDiscoveryArea(destination)) {
    throw new RangeError('Le coordinate devono ricadere nell’area di Milano.');
  }
  const straightLineKm = haversineDistanceKm(origin, destination);
  const estimatedWalkingKm = straightLineKm * WALKING_DISTANCE_FACTOR;
  return Object.freeze({
    minutes: Math.max(1, Math.round((estimatedWalkingKm / ASSUMED_WALKING_SPEED_KMH) * 60)),
    straightLineKm: Number(straightLineKm.toFixed(3)),
    estimatedWalkingKm: Number(estimatedWalkingKm.toFixed(3)),
    mode: 'walk',
    kind: 'session-estimate',
    originLabel: 'La tua posizione',
    disclosure: 'stimata, non routing',
  });
}

export type SessionTravelEstimates = Readonly<Record<string, SessionTravelEstimate>>;

/** Produces a detached map and never mutates catalog records or their provenance. */
export function buildSessionTravelEstimates(
  catalog: readonly Venue[],
  origin: DiscoveryCoordinates,
): SessionTravelEstimates {
  if (!isWithinMilanDiscoveryArea(origin)) {
    throw new RangeError('La posizione non ricade nell’area di Milano.');
  }
  return Object.freeze(Object.fromEntries(
    catalog.map((venue) => [venue.id, estimateSessionWalk(origin, venue.discoveryLocation)]),
  ));
}
