import { isValidMilanPublicationGeo, type VenueDirectionsAction } from './venue';

/**
 * Google Maps universal Directions URL, documented at:
 * https://developers.google.com/maps/documentation/urls/get-started#directions-action
 *
 * The URL deliberately omits `origin`: TRE sends only the verified venue
 * destination. Google Maps may ask the person for an origin after navigation.
 */
export function createVenueDirectionsUrl(action: VenueDirectionsAction) {
  if (!isValidMilanPublicationGeo(action.destination)) throw new TypeError('Invalid verified venue destination.');
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', `${action.destination.latitude},${action.destination.longitude}`);
  url.searchParams.set('travelmode', 'walking');
  return url.toString();
}

