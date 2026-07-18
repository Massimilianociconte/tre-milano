export type PriceLevel = 1 | 2 | 3 | 4;

export const VENUE_MATURITY_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'] as const;
export type VenueMaturityTier = (typeof VENUE_MATURITY_TIERS)[number];

const RECOMMENDATION_MATURITY_TIERS = new Set<VenueMaturityTier>(['Gold', 'Platinum']);

export function isVenueMaturityTier(value: unknown): value is VenueMaturityTier {
  return typeof value === 'string' && VENUE_MATURITY_TIERS.includes(value as VenueMaturityTier);
}

/** Bronze and Silver records are intentionally browse-only and can never enter a podium. */
export function isRecommendationMaturityTier(value: unknown): value is Extract<VenueMaturityTier, 'Gold' | 'Platinum'> {
  return isVenueMaturityTier(value) && RECOMMENDATION_MATURITY_TIERS.has(value);
}

export type VenueCategory =
  | 'Cocktail bar'
  | 'Ristorante'
  | 'Enoteca'
  | 'Rooftop'
  | 'Caffè';

export type VenueActionProvenance = {
  source: 'official' | 'editorial';
  sourceUrl: string;
  checkedAt: string;
  validUntil: string;
  confidence: number;
};

export type VenueUrlAction = {
  url: string;
  provenance: VenueActionProvenance;
};

export type VenueTelephoneAction = {
  telephone: string;
  provenance: VenueActionProvenance;
};

export type VenueDirectionsAction = {
  destination: {
    latitude: number;
    longitude: number;
  };
  provenance: VenueActionProvenance;
};

export type VenuePublicationActions = {
  official?: VenueUrlAction;
  menu?: VenueUrlAction;
  reservation?: VenueUrlAction;
  telephone?: VenueTelephoneAction;
  directions?: VenueDirectionsAction;
};

export type VenuePublication = {
  officialUrl: string;
  /** Verified Schema.org type; never inferred from the product taxonomy. */
  schemaType: 'BarOrPub' | 'Restaurant' | 'CafeOrCoffeeShop' | 'LiquorStore' | 'LocalBusiness';
  address: {
    streetAddress: string;
    postalCode: string;
    addressLocality: 'Milano';
    addressRegion: 'MI';
    addressCountry: 'IT';
  };
  telephone?: string;
  geo?: {
    latitude: number;
    longitude: number;
  };
  openingHours: string[];
  /**
   * Operational CTAs are opt-in and independently sourced. A factual field in
   * the passport never becomes an action merely because it happens to exist.
   */
  actions?: VenuePublicationActions;
};

export type VenueOpenStatus = {
  value: boolean;
  checkedAt: string;
  validUntil: string;
  source: 'fixture' | 'official' | 'editorial';
  sourceUrl?: string;
};

export type WeekdayKey = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';

export type VenueAvailability = {
  timezone: 'Europe/Rome';
  weekly: Partial<Record<WeekdayKey, Array<{ opens: string; closes: string }>>>;
  checkedAt: string;
  validUntil: string;
  source: 'fixture' | 'official' | 'editorial';
  sourceUrl?: string;
};

export type VenueTravelEstimate = {
  minutes: number;
  mode: 'walk';
  origin: {
    id: string;
    label: string;
    shortLabel: string;
    latitude: number;
    longitude: number;
  };
  checkedAt: string;
  validUntil: string;
  source: 'fixture' | 'routing' | 'editorial';
  sourceUrl?: string;
};

/** Coordinates used only by the discovery experience, independently from publication.geo. */
export type DiscoveryCoordinates = {
  latitude: number;
  longitude: number;
};

/**
 * Ephemeral client-side estimate. It is intentionally not a sourced
 * VenueTravelEstimate and therefore cannot satisfy any Gold/publication gate.
 */
export type SessionTravelEstimate = {
  minutes: number;
  straightLineKm: number;
  estimatedWalkingKm: number;
  mode: 'walk';
  kind: 'session-estimate';
  originLabel: 'La tua posizione';
  disclosure: 'stimata, non routing';
};

export type VenueSourceRecord = {
  source: 'fixture' | 'official' | 'editorial';
  sourceUrl?: string;
  checkedAt: string;
  validUntil: string;
  confidence: number;
};

export type VenueFieldProvenance = {
  pricing: VenueSourceRecord;
  attributes: VenueSourceRecord;
  imageRights: VenueSourceRecord & {
    rightsStatus: 'fixture' | 'owned' | 'licensed';
    rightsHolder: string;
  };
};

/**
 * Same-origin catalog summaries are intentionally less detailed than a full
 * editorial passport. This evidence can admit an already verified/published
 * API record to the runtime ranker, but it never satisfies publication,
 * structured-data or Gold provenance gates on its own.
 */
export type CatalogApiRankingEvidence = {
  source: 'catalog-api';
  qualityScore: number;
  generatedAt: string;
  travelDisclosure: 'stimata, non routing';
};

export type Venue = {
  id: string;
  slug: string;
  name: string;
  neighborhood: string;
  category: VenueCategory;
  image: string;
  imageAlt: string;
  imageWidth: number;
  imageHeight: number;
  priceLevel: PriceLevel;
  averageSpend: number;
  /** False when the public catalog projection has no verified monetary amount. */
  pricingKnown?: boolean;
  /** Ranking-only point; never reused as verified publication.geo. */
  discoveryLocation: DiscoveryCoordinates;
  /** Estimate tied to the declared origin; never a venue-global distance claim. */
  travelEstimate: VenueTravelEstimate;
  /** Field-level provenance required by the Gold catalog gate. */
  provenance: VenueFieldProvenance;
  openStatus: VenueOpenStatus;
  availability: VenueAvailability;
  atmosphere: string[];
  occasions: string[];
  features: string[];
  /** Curated Gold-only vocabulary used by the local deterministic retriever. */
  semanticTags?: string[];
  confidence: number;
  verifiedAt: string;
  /** Explicit catalog maturity; only Gold/Platinum records may enter recommendation. */
  maturityTier: VenueMaturityTier;
  /** Must be false before a production + Gold build can be published. */
  fixtureOnly: boolean;
  recommendationEligible: boolean;
  /** Runtime-only admission evidence supplied by the same-origin catalog API. */
  catalogApiRankingEvidence?: CatalogApiRankingEvidence;
  /** Required factual payload before a venue can emit LocalBusiness markup. */
  publication?: VenuePublication;
};

/** PRD launch gate: no Gold recommendation below this aggregate confidence. */
export const GOLD_CONFIDENCE_MINIMUM = 0.7;
export const GOLD_VERIFICATION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const VENUE_ACTION_MAX_VALIDITY_MS = 90 * 24 * 60 * 60 * 1000;

export type VenueEligibilityMode = 'fixture-preview' | 'production';

export const isPublicHttpsUrl = (value: string) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase('en-US');
    const isIpLiteral = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
      || (hostname.startsWith('[') && hostname.endsWith(']'));
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (url.port === '' || url.port === '443')
      && hostname.length > 0
      && !hostname.endsWith('.')
      && hostname.includes('.')
      && !isIpLiteral
      && hostname !== 'localhost'
      && !hostname.endsWith('.local')
      && !hostname.endsWith('.localhost')
      && !hostname.endsWith('.internal')
      && !hostname.endsWith('.test')
      && !hostname.endsWith('.invalid')
      && !hostname.endsWith('.example')
      && !['example.com', 'example.org', 'example.net'].includes(hostname);
  } catch {
    return false;
  }
};

const hasFreshWindow = (checkedAtValue: string, validUntilValue: string, at: number, maxWindowMs: number) => {
  const checkedAt = Date.parse(checkedAtValue);
  const validUntil = Date.parse(validUntilValue);
  return Number.isFinite(checkedAt)
    && Number.isFinite(validUntil)
    && checkedAt <= at
    && validUntil > at
    && validUntil > checkedAt
    && validUntil - checkedAt <= maxWindowMs;
};

export function isValidVenueTelephone(value: unknown): value is string {
  return typeof value === 'string' && /^\+39\d{6,11}$/.test(value);
}

export function isValidMilanPublicationGeo(value: unknown): value is { latitude: number; longitude: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const geo = value as { latitude?: unknown; longitude?: unknown };
  return typeof geo.latitude === 'number'
    && typeof geo.longitude === 'number'
    && Number.isFinite(geo.latitude)
    && Number.isFinite(geo.longitude)
    && geo.latitude >= 45.35
    && geo.latitude <= 45.58
    && geo.longitude >= 9.0
    && geo.longitude <= 9.35;
}

export function hasUsableVenueActionProvenance(value: unknown, at = Date.now()): value is VenueActionProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Number.isFinite(at)) return false;
  const provenance = value as Partial<VenueActionProvenance>;
  return (provenance.source === 'official' || provenance.source === 'editorial')
    && typeof provenance.sourceUrl === 'string'
    && isPublicHttpsUrl(provenance.sourceUrl)
    && typeof provenance.checkedAt === 'string'
    && typeof provenance.validUntil === 'string'
    && typeof provenance.confidence === 'number'
    && Number.isFinite(provenance.confidence)
    && provenance.confidence >= GOLD_CONFIDENCE_MINIMUM
    && provenance.confidence <= 1
    && hasFreshWindow(provenance.checkedAt, provenance.validUntil, at, VENUE_ACTION_MAX_VALIDITY_MS);
}

export type VenueActionKind = keyof VenuePublicationActions;

const ACTION_KINDS: VenueActionKind[] = ['official', 'menu', 'reservation', 'telephone', 'directions'];

export function isValidVenuePublicationAction(
  publication: VenuePublication,
  kind: VenueActionKind,
  at = Date.now(),
) {
  const action = publication.actions?.[kind];
  if (!action || !hasUsableVenueActionProvenance(action.provenance, at)) return false;

  if (kind === 'official' || kind === 'menu' || kind === 'reservation') {
    const urlAction = action as VenueUrlAction;
    return isPublicHttpsUrl(urlAction.url)
      && (kind !== 'official' || urlAction.url === publication.officialUrl);
  }
  if (kind === 'telephone') {
    const telephoneAction = action as VenueTelephoneAction;
    return isValidVenueTelephone(telephoneAction.telephone)
      && telephoneAction.telephone === publication.telephone;
  }

  const directionsAction = action as VenueDirectionsAction;
  return isValidMilanPublicationGeo(directionsAction.destination)
    && isValidMilanPublicationGeo(publication.geo)
    && directionsAction.destination.latitude === publication.geo.latitude
    && directionsAction.destination.longitude === publication.geo.longitude;
}

export function hasValidVenuePublicationActions(publication: VenuePublication, at = Date.now()) {
  if (publication.actions === undefined) return true;
  if ((publication.actions as unknown) === null
    || typeof publication.actions !== 'object'
    || Array.isArray(publication.actions)) return false;
  const declaredKinds = Object.keys(publication.actions);
  return declaredKinds.every((kind) => ACTION_KINDS.includes(kind as VenueActionKind))
    && ACTION_KINDS.every((kind) => publication.actions?.[kind] === undefined
      || isValidVenuePublicationAction(publication, kind, at));
}

export function getVerifiedVenuePublicationActions(venue: Venue, at = Date.now()): VenuePublicationActions {
  if (!isVenuePublishable(venue, at) || !venue.publication.actions) return {};
  return ACTION_KINDS.reduce<VenuePublicationActions>((verified, kind) => {
    if (isValidVenuePublicationAction(venue.publication, kind, at)) {
      Object.assign(verified, { [kind]: venue.publication.actions?.[kind] });
    }
    return verified;
  }, {});
}

export function hasFreshVenueVerification(venue: Venue, at = Date.now()) {
  if (!Number.isFinite(at)) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const valueFor = (type: 'year' | 'month' | 'day') => parts.find((part) => part.type === type)?.value;
  const today = `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`;
  const verifiedAt = Date.parse(`${venue.verifiedAt}T00:00:00Z`);
  const currentDate = Date.parse(`${today}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(venue.verifiedAt)
    && Number.isFinite(verifiedAt)
    && Number.isFinite(currentDate)
    && new Date(verifiedAt).toISOString().slice(0, 10) === venue.verifiedAt
    && verifiedAt <= currentDate
    && currentDate - verifiedAt <= GOLD_VERIFICATION_MAX_AGE_MS;
}

export function hasUsableOpenStatus(venue: Venue, at = Date.now()) {
  const { openStatus } = venue;
  if (venue.fixtureOnly && openStatus.source === 'fixture') return true;
  if (openStatus.source === 'fixture' || !openStatus.sourceUrl) return false;

  try {
    return isPublicHttpsUrl(openStatus.sourceUrl)
      && hasFreshWindow(openStatus.checkedAt, openStatus.validUntil, at, 48 * 60 * 60 * 1000);
  } catch {
    return false;
  }
}

export function hasUsableAvailability(venue: Venue, at = Date.now()) {
  const { availability } = venue;
  if (venue.fixtureOnly && availability.source === 'fixture') return true;
  if (availability.source === 'fixture' || !availability.sourceUrl) return false;

  try {
    return isPublicHttpsUrl(availability.sourceUrl)
      && hasFreshWindow(availability.checkedAt, availability.validUntil, at, 90 * 24 * 60 * 60 * 1000)
      && Object.values(availability.weekly).some((windows) => windows?.length);
  } catch {
    return false;
  }
}

export function hasUsableTravelEstimate(venue: Venue, at = Date.now()) {
  const estimate = venue.travelEstimate;
  if (venue.fixtureOnly && estimate.source === 'fixture') return true;
  if (estimate.source === 'fixture' || !estimate.sourceUrl) return false;

  try {
    return isPublicHttpsUrl(estimate.sourceUrl)
      && estimate.mode === 'walk'
      && Number.isFinite(estimate.minutes)
      && estimate.minutes > 0
      && estimate.minutes <= 240
      && Boolean(estimate.origin.id.trim() && estimate.origin.label.trim() && estimate.origin.shortLabel.trim())
      && Number.isFinite(estimate.origin.latitude)
      && estimate.origin.latitude >= 45.35
      && estimate.origin.latitude <= 45.58
      && Number.isFinite(estimate.origin.longitude)
      && estimate.origin.longitude >= 9.0
      && estimate.origin.longitude <= 9.35
      && hasFreshWindow(estimate.checkedAt, estimate.validUntil, at, 30 * 24 * 60 * 60 * 1000);
  } catch {
    return false;
  }
}

export function hasUsableFieldProvenance(venue: Venue, at = Date.now()) {
  const records = [venue.provenance.pricing, venue.provenance.attributes, venue.provenance.imageRights];
  if (venue.fixtureOnly && records.every((record) => record.source === 'fixture')) return true;

  return records.every((record) => (
    record.source !== 'fixture'
    && Boolean(record.sourceUrl && isPublicHttpsUrl(record.sourceUrl))
    && Number.isFinite(record.confidence)
    && record.confidence >= GOLD_CONFIDENCE_MINIMUM
    && record.confidence <= 1
    && hasFreshWindow(record.checkedAt, record.validUntil, at, 180 * 24 * 60 * 60 * 1000)
  ))
    && venue.provenance.imageRights.rightsStatus !== 'fixture'
    && Boolean(venue.provenance.imageRights.rightsHolder.trim());
}

/**
 * Single recommendation eligibility contract shared by ranking and public
 * publication. Fixtures remain usable only in the declared preview mode;
 * production venues must keep every critical freshness/provenance window live.
 */
export function isVenueRecommendationEligible(
  venue: Venue,
  at = Date.now(),
  mode: VenueEligibilityMode = venue.fixtureOnly ? 'fixture-preview' : 'production',
) {
  if (!venue.recommendationEligible) return false;
  if (!isRecommendationMaturityTier(venue.maturityTier)) return false;
  if (!Number.isFinite(venue.confidence) || venue.confidence < GOLD_CONFIDENCE_MINIMUM || venue.confidence > 1) {
    return false;
  }
  if (venue.fixtureOnly && mode !== 'fixture-preview') return false;
  if (!venue.fixtureOnly && !hasFreshVenueVerification(venue, at)) return false;

  return hasUsableOpenStatus(venue, at)
    && hasUsableAvailability(venue, at)
    && hasUsableTravelEstimate(venue, at)
    && hasUsableFieldProvenance(venue, at);
}

/**
 * Ranking admission for the reduced public catalog projection. The strict
 * recommendation/publication contract above remains untouched: summaries do
 * not become publishable merely because they can participate in discovery.
 */
export function isVenueCatalogApiRankingEligible(venue: Venue, at = Date.now()) {
  const evidence = venue.catalogApiRankingEvidence;
  const generatedAt = evidence ? Date.parse(evidence.generatedAt) : Number.NaN;
  return Boolean(
    evidence
      && evidence.source === 'catalog-api'
      && !venue.fixtureOnly
      && venue.recommendationEligible
      && isRecommendationMaturityTier(venue.maturityTier)
      && Number.isFinite(venue.confidence)
      && venue.confidence >= GOLD_CONFIDENCE_MINIMUM
      && venue.confidence <= 1
      && Number.isFinite(evidence.qualityScore)
      && evidence.qualityScore >= 0
      && evidence.qualityScore <= 100
      && Number.isFinite(generatedAt)
      && generatedAt <= at + 5 * 60 * 1000
      && isValidMilanPublicationGeo(venue.discoveryLocation)
      && hasFreshVenueVerification(venue, at),
  );
}

export function isVenueRankingEligible(venue: Venue, at = Date.now()) {
  return isVenueRecommendationEligible(venue, at)
    || isVenueCatalogApiRankingEligible(venue, at);
}

export function hasKnownVenuePricing(venue: Venue) {
  return venue.pricingKnown !== false
    && Number.isFinite(venue.averageSpend)
    && venue.averageSpend > 0;
}

const WEEKDAYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const timeToMinutes = (value: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined;
};

export function isVenueAvailableAt(venue: Venue, weekday: number, minutes: number, at = Date.now()) {
  if (!hasUsableAvailability(venue, at) || weekday < 0 || weekday > 6 || minutes < 0 || minutes >= 1440) return false;
  const currentDay = WEEKDAYS[weekday];
  const previousDay = WEEKDAYS[(weekday + 6) % 7];
  const currentWindows = venue.availability.weekly[currentDay] ?? [];
  const previousWindows = venue.availability.weekly[previousDay] ?? [];

  const startsToday = currentWindows.some(({ opens, closes }) => {
    const start = timeToMinutes(opens);
    const end = timeToMinutes(closes);
    if (start === undefined || end === undefined) return false;
    return end > start ? minutes >= start && minutes < end : minutes >= start;
  });
  const continuesFromYesterday = previousWindows.some(({ opens, closes }) => {
    const start = timeToMinutes(opens);
    const end = timeToMinutes(closes);
    return start !== undefined && end !== undefined && end <= start && minutes < end;
  });
  return startsToday || continuesFromYesterday;
}

export function isVenuePublishable(venue: Venue, at = Date.now()): venue is Venue & { publication: VenuePublication } {
  if (
    venue.fixtureOnly
    || !isVenueRecommendationEligible(venue, at, 'production')
    || !venue.publication
  ) return false;

  try {
    return isPublicHttpsUrl(venue.publication.officialUrl)
      && ['BarOrPub', 'Restaurant', 'CafeOrCoffeeShop', 'LiquorStore', 'LocalBusiness'].includes(venue.publication.schemaType)
      && Boolean(venue.publication.address.streetAddress.trim())
      && /^20\d{3}$/.test(venue.publication.address.postalCode)
      && venue.publication.openingHours.length > 0
      && (venue.publication.telephone === undefined || isValidVenueTelephone(venue.publication.telephone))
      && (venue.publication.geo === undefined || isValidMilanPublicationGeo(venue.publication.geo))
      && hasValidVenuePublicationActions(venue.publication, at);
  } catch {
    return false;
  }
}

export type VenueCatalogStatus = {
  value: 'explore-only' | 'fixture-recommendation-preview' | 'verification-pending' | 'recommendation-ready';
  label: string;
  description: string;
};

/** Human-readable state derived from the same maturity and provenance rules used by ranking. */
export function getVenueCatalogStatus(venue: Venue, at = Date.now()): VenueCatalogStatus {
  if (!isRecommendationMaturityTier(venue.maturityTier)) {
    return {
      value: 'explore-only',
      label: 'Solo esplorazione',
      description: `Livello ${venue.maturityTier}: la scheda è consultabile, ma resta esclusa da podio e raccomandazioni.`,
    };
  }

  if (venue.fixtureOnly) {
    return {
      value: 'fixture-recommendation-preview',
      label: 'Podio solo in anteprima',
      description: `Livello ${venue.maturityTier} simulato: può validare il flusso demo, ma non è pubblicabile né indicizzabile.`,
    };
  }

  if (!isVenueRecommendationEligible(venue, at, 'production')) {
    return {
      value: 'verification-pending',
      label: 'Verifica in corso',
      description: `Livello ${venue.maturityTier}: la scheda resta fuori dal podio finché tutti i gate di freschezza e provenance non sono validi.`,
    };
  }

  return {
    value: 'recommendation-ready',
    label: 'Idonea alla raccomandazione',
    description: `Livello ${venue.maturityTier}: supera i gate correnti per entrare nel ranking.`,
  };
}

export type PodiumRole = 'best-fit' | 'safe-alternative' | 'smart-wildcard';

export type RankedVenue = Venue & {
  rank: 1 | 2 | 3;
  role: PodiumRole;
  score: number;
  reason: string;
  reasonCodes: RankingReasonCode[];
  matchedConcepts: string[];
  /** Explicit local-profile signals that weakly refined this result. */
  profileMatches: string[];
  /** Non-hard preference dimensions deliberately changed from rank #1. */
  divergenceDimensions: string[];
  tradeoff: string;
  /** Present only after a foreground location action in the current tab. */
  sessionTravelEstimate?: SessionTravelEstimate;
};

export type RankingReasonCode =
  | 'GOLD_ELIGIBLE'
  | 'CATEGORY_MATCH'
  | 'NEIGHBORHOOD_MATCH'
  | 'OCCASION_MATCH'
  | 'ATMOSPHERE_MATCH'
  | 'FEATURE_MATCH'
  | 'SEMANTIC_MATCH'
  | 'PROFILE_MATCH'
  | 'OPEN_NOW'
  | 'CLOSE_BY'
  | 'HIGH_CONFIDENCE'
  | 'DIVERSITY_ALTERNATIVE'
  | 'CONTROLLED_WILDCARD';

export type SearchIntent = {
  query: string;
  category?: VenueCategory;
  categories: VenueCategory[];
  requiredCategories: VenueCategory[];
  excludedCategories: VenueCategory[];
  neighborhood?: string;
  neighborhoods: string[];
  requiredNeighborhoods: string[];
  excludedNeighborhoods: string[];
  minSpend?: number;
  maxSpend?: number;
  maxMinutes?: number;
  /** Parsed locally and fail-closed until verified venue capacity exists. */
  partySize?: number;
  travelOriginId?: string;
  requiresOpenNow: boolean;
  requestedServiceTime?: {
    weekday: number;
    minutes: number;
    label: string;
  };
  atmosphere: string[];
  /** Required moods connected by AND (for example "intimo e tranquillo"). */
  requiredAtmosphere: string[];
  /** Required moods connected by OR (for example "intimo oppure tranquillo"). */
  requiredAtmosphereAny: string[];
  excludedAtmosphere: string[];
  occasion?: string;
  occasions: string[];
  requiredOccasions: string[];
  excludedOccasions: string[];
  concepts: string[];
  requiredConcepts: string[];
  excludedConcepts: string[];
  semanticTokens: string[];
  unsupportedConstraints: Array<{
    code:
      | 'EXACT_OPENING_TIME'
      | 'DIETARY_SAFETY'
      | 'ACCESSIBILITY'
      | 'TRAVEL_ORIGIN'
      | 'PARTY_SIZE'
      | 'UNVERIFIED_SERVICE'
      | 'UNVERIFIED_DIETARY_OPTION';
    label: string;
  }>;
};
