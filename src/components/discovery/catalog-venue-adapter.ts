import {
  CATALOG_API_VERSION,
  type CatalogVenueSummary,
  type CatalogVenueWeeklyHour,
} from '../../domain/catalog-api';
import {
  DUOMO_DISCOVERY_ORIGIN,
  estimateSessionWalk,
  isWithinMilanDiscoveryArea,
} from '../../domain/discovery-location';
import {
  isPublicHttpsUrl,
  isVenueCatalogApiRankingEligible,
  type PriceLevel,
  type Venue,
  type VenueCategory,
  type VenueMaturityTier,
  type WeekdayKey,
} from '../../domain/venue';
import {
  CONTROLLED_ATMOSPHERES,
  CONTROLLED_CONCEPTS,
  CONTROLLED_DIETARY_PREFERENCES,
  CONTROLLED_NEIGHBORHOODS,
  CONTROLLED_OCCASIONS,
  CONTROLLED_SERVICES,
  type ControlledConcept,
  type ControlledDietaryPreference,
  type ControlledService,
} from '../../search/interpretation-contract';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAY_KEYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LOCAL_IMAGE_ASSETS = {
  '/images/venue-cocktail.webp': { width: 900, height: 1124 },
  '/images/venue-navigli.webp': { width: 900, height: 1124 },
  '/images/venue-ristorante.webp': { width: 900, height: 1124 },
  '/images/galleria-milano.webp': { width: 1400, height: 933 },
  '/images/hero-milano.webp': { width: 1672, height: 941 },
} as const;

type LocalImagePath = keyof typeof LOCAL_IMAGE_ASSETS;

const CATEGORY_IMAGES: Record<VenueCategory, LocalImagePath> = {
  'Cocktail bar': '/images/venue-cocktail.webp',
  Ristorante: '/images/venue-ristorante.webp',
  Enoteca: '/images/venue-navigli.webp',
  Rooftop: '/images/hero-milano.webp',
  Caffè: '/images/galleria-milano.webp',
};

const CATEGORY_ALIASES: Record<string, VenueCategory> = {
  'cocktail bar': 'Cocktail bar',
  'cocktail-bar': 'Cocktail bar',
  ristorante: 'Ristorante',
  restaurant: 'Ristorante',
  enoteca: 'Enoteca',
  'wine-bar': 'Enoteca',
  rooftop: 'Rooftop',
  'rooftop-bar': 'Rooftop',
  caffe: 'Caffè',
  caffè: 'Caffè',
  caffetteria: 'Caffè',
  pasticceria: 'Caffè',
};

const CATEGORY_QUERY_SLUGS: Record<VenueCategory, string> = {
  'Cocktail bar': 'cocktail-bar',
  Ristorante: 'ristorante',
  Enoteca: 'enoteca',
  Rooftop: 'rooftop',
  Caffè: 'caffe',
};

export type CatalogVenuePayload = {
  generatedAt: string;
  summaries: CatalogVenueSummary[];
  pagination: {
    nextCursor: string | null;
    limit: number;
    hasMore: boolean;
  };
};

export type CatalogCandidateIntent = {
  categories: readonly string[];
  neighborhoods: readonly string[];
  requiredServices?: readonly string[];
  requiredDietaryPreferences?: readonly string[];
  atmosphere?: readonly string[];
  occasions?: readonly string[];
  concepts?: readonly string[];
};

export type CatalogCandidateFetcher = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

const CATALOG_CANDIDATE_MAX_REQUESTS = 3;
const CATALOG_CANDIDATE_MAX_SUMMARIES = 150;
const CATALOG_CANDIDATE_SEMANTIC_TERM_LIMIT = 8;
const CATALOG_CANDIDATE_SEMANTIC_QUERY_MAX_LENGTH = 160;

const CATALOG_SERVICE_SLUGS: Partial<Record<ControlledService | ControlledDietaryPreference, string>> = {
  prenotazione: 'prenotazione',
  asporto: 'asporto',
  consegna: 'consegna',
  wifi: 'wifi',
  musica: 'musica-live',
  'pet friendly': 'pet-friendly',
  parcheggio: 'parcheggio',
  'eventi privati': 'eventi-privati',
  'opzioni vegane': 'opzioni-vegane',
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

function isCatalogWeeklyHour(value: unknown): value is CatalogVenueWeeklyHour {
  if (!isRecord(value)
    || !Number.isInteger(value.weekday)
    || Number(value.weekday) < 0
    || Number(value.weekday) > 6
    || !Number.isInteger(value.sequence)
    || Number(value.sequence) < 1
    || Number(value.sequence) > 8
    || typeof value.closed !== 'boolean'
    || typeof value.closesNextDay !== 'boolean'
    || typeof value.verifiedAt !== 'string'
    || !Number.isFinite(Date.parse(value.verifiedAt))
    || (value.validUntil !== null && (typeof value.validUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.validUntil)))) {
    return false;
  }
  return value.closed
    ? value.opensAt === null && value.closesAt === null
    : typeof value.opensAt === 'string'
      && TIME.test(value.opensAt)
      && typeof value.closesAt === 'string'
      && TIME.test(value.closesAt);
}

function normalise(value: string) {
  return value
    .toLocaleLowerCase('it-IT')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’'`]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCatalogVenueSummary(value: unknown): value is CatalogVenueSummary {
  if (!isRecord(value)
    || typeof value.id !== 'string'
    || !value.id.trim()
    || typeof value.slug !== 'string'
    || !SLUG.test(value.slug)
    || typeof value.name !== 'string'
    || !value.name.trim()
    || (value.shortDescription !== null && typeof value.shortDescription !== 'string')
    || !isRecord(value.category)
    || typeof value.category.slug !== 'string'
    || typeof value.category.name !== 'string'
    || (value.subcategorySlug !== null
      && (typeof value.subcategorySlug !== 'string' || !SLUG.test(value.subcategorySlug)))
    || !isRecord(value.location)
    || !isFiniteNumber(value.location.latitude)
    || !isFiniteNumber(value.location.longitude)
    || typeof value.formattedAddress !== 'string'
    || !isRecord(value.price)
    || (value.price.level !== null && !isFiniteNumber(value.price.level))
    || (value.price.averageSpendCents !== null && !isFiniteNumber(value.price.averageSpendCents))
    || value.price.currency !== 'EUR'
    || !Array.isArray(value.ratings)
    || !Array.isArray(value.services)
    || !value.services.every((service) => typeof service === 'string')
    || (value.weeklyHours !== undefined && (
      !Array.isArray(value.weeklyHours)
      || !value.weeklyHours.every(isCatalogWeeklyHour)
    ))
    || (value.hoursSourceUrl !== undefined
      && value.hoursSourceUrl !== null
      && typeof value.hoursSourceUrl !== 'string')
    || typeof value.recommendationEligible !== 'boolean'
    || typeof value.openNow !== 'boolean'
    || !isRecord(value.verification)
    || (value.verification.status !== null
      && !['unverified', 'pending', 'verified', 'disputed', 'rejected'].includes(String(value.verification.status)))
    || !['bronze', 'silver', 'gold', 'platinum'].includes(String(value.verification.maturity))
    || !isFiniteNumber(value.verification.qualityScore)
    || !isFiniteNumber(value.verification.confidenceScore)
    || (value.verification.verifiedAt !== null && typeof value.verification.verifiedAt !== 'string')) return false;

  if (value.neighborhood !== null && (
    !isRecord(value.neighborhood)
    || typeof value.neighborhood.slug !== 'string'
    || typeof value.neighborhood.name !== 'string'
  )) return false;

  return value.primaryImage === null || (
    isRecord(value.primaryImage)
    && typeof value.primaryImage.url === 'string'
    && typeof value.primaryImage.alt === 'string'
  );
}

/** Runtime validator: malformed rows are discarded without taking down valid catalog records. */
export function parseCatalogVenuePayload(value: unknown): CatalogVenuePayload | null {
  if (!isRecord(value)
    || value.version !== CATALOG_API_VERSION
    || !Array.isArray(value.data)
    || !isRecord(value.pagination)
    || !Number.isInteger(value.pagination.limit)
    || Number(value.pagination.limit) < 1
    || Number(value.pagination.limit) > 50
    || typeof value.pagination.hasMore !== 'boolean'
    || (value.pagination.nextCursor !== null && (
      typeof value.pagination.nextCursor !== 'string'
      || value.pagination.nextCursor.length > 512
      || !/^[A-Za-z0-9_-]+$/.test(value.pagination.nextCursor)
    ))
    || (value.pagination.hasMore !== (value.pagination.nextCursor !== null))
    || !isRecord(value.meta)
    || typeof value.meta.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.meta.generatedAt))) return null;

  return {
    generatedAt: value.meta.generatedAt,
    summaries: value.data.filter(isCatalogVenueSummary),
    pagination: {
      nextCursor: value.pagination.nextCursor,
      limit: Number(value.pagination.limit),
      hasMore: value.pagination.hasMore,
    },
  };
}

function categoryForValues(name: string, slug: string): VenueCategory | null {
  return CATEGORY_ALIASES[normalise(name)]
    ?? CATEGORY_ALIASES[normalise(slug).replace(/ /g, '-')]
    ?? null;
}

function categoryFor(summary: CatalogVenueSummary): VenueCategory | null {
  return categoryForValues(summary.category.name, summary.category.slug);
}

function maturityFor(value: CatalogVenueSummary['verification']['maturity']): VenueMaturityTier {
  return `${value[0].toLocaleUpperCase('it-IT')}${value.slice(1)}` as VenueMaturityTier;
}

function priceFor(summary: CatalogVenueSummary): { level: PriceLevel; averageSpend: number; known: boolean } {
  const exactSpend = summary.price.averageSpendCents !== null && summary.price.averageSpendCents > 0
    ? Math.round(summary.price.averageSpendCents / 100)
    : null;
  const statedLevel = summary.price.level;
  const derivedLevel = exactSpend === null
    ? 2
    : exactSpend <= 20
      ? 1
      : exactSpend <= 35
        ? 2
        : exactSpend <= 60
          ? 3
          : 4;
  const level = Number.isInteger(statedLevel) && statedLevel! >= 1 && statedLevel! <= 4
    ? statedLevel as PriceLevel
    : derivedLevel;
  return { level, averageSpend: exactSpend ?? 0, known: exactSpend !== null };
}

function addDays(value: string, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addMinutes(value: string, minutes: number) {
  const date = new Date(value);
  date.setUTCMinutes(date.getUTCMinutes() + minutes);
  return date.toISOString();
}

function earliestIso(values: string[]) {
  const timestamps = values.map(Date.parse).filter(Number.isFinite);
  return timestamps.length ? new Date(Math.min(...timestamps)).toISOString() : null;
}

function scheduleState(summary: CatalogVenueSummary, generatedAt: string): Pick<Venue, 'availability' | 'openStatus'> {
  const hours = summary.weeklyHours ?? [];
  const sourceUrl = summary.hoursSourceUrl?.trim();
  const checkedAt = earliestIso(hours.map((hour) => hour.verifiedAt));
  const validThrough = earliestIso(hours.flatMap((hour) => hour.validUntil
    ? [`${hour.validUntil}T23:59:59.999Z`]
    : []));
  const provenanceValidUntil = checkedAt
    ? [addDays(checkedAt, 90), validThrough].filter((value): value is string => Boolean(value)).sort()[0]
    : addDays(generatedAt, 1);
  const weekly = hours.reduce<Venue['availability']['weekly']>((result, hour) => {
    if (hour.closed || !hour.opensAt || !hour.closesAt) return result;
    const key = WEEKDAY_KEYS[hour.weekday];
    result[key] = [...(result[key] ?? []), { opens: hour.opensAt, closes: hour.closesAt }];
    return result;
  }, {});
  const generatedTime = Date.parse(generatedAt);
  const provenanceUsable = Boolean(
    checkedAt
      && sourceUrl
      && isPublicHttpsUrl(sourceUrl)
      && Date.parse(checkedAt) <= generatedTime
      && Date.parse(provenanceValidUntil) > generatedTime
      && Object.values(weekly).some((windows) => windows?.length),
  );
  // The server evaluates the current instant against verified weekly hours
  // and dated exceptions; the client never re-derives a potentially stale
  // answer that could ignore an exceptional closure.
  const isOpen = provenanceUsable && summary.openNow;

  if (!hours.length || !checkedAt) {
    return {
      openStatus: {
        value: false,
        checkedAt: generatedAt,
        validUntil: addDays(generatedAt, 1),
        source: 'editorial',
      },
      availability: {
        timezone: 'Europe/Rome',
        weekly: {},
        checkedAt: generatedAt,
        validUntil: addDays(generatedAt, 1),
        source: 'editorial',
      },
    };
  }

  return {
    openStatus: {
      value: isOpen,
      checkedAt: generatedAt,
      validUntil: addMinutes(generatedAt, 5),
      source: 'official',
      ...(provenanceUsable ? { sourceUrl } : {}),
    },
    availability: {
      timezone: 'Europe/Rome',
      weekly,
      checkedAt,
      validUntil: provenanceValidUntil,
      source: 'official',
      ...(sourceUrl ? { sourceUrl } : {}),
    },
  };
}

function humaniseService(value: string) {
  return value.replace(/[-_]+/g, ' ').trim();
}

const SERVICE_CONCEPT_BY_SLUG = new Map<string, ControlledConcept>(
  Object.entries(CATALOG_SERVICE_SLUGS).flatMap(([concept, slug]) => (
    slug ? [[slug, concept as ControlledConcept]] : []
  )),
);

/**
 * Only structured service rows may become factual ranking attributes. Free
 * prose remains searchable below, but can never satisfy a mandatory concept.
 */
function structuredConceptsForServices(services: readonly string[]) {
  return services.flatMap((service) => {
    const concept = SERVICE_CONCEPT_BY_SLUG.get(service);
    return concept ? [concept] : [];
  });
}

export type CatalogLocalVisual = {
  path: LocalImagePath;
  alt: string;
  width: number;
  height: number;
};

/**
 * The public catalog may reference third-party media. Discovery and the
 * runtime detail page deliberately render only owned, same-origin allowlisted
 * assets until the complete media-rights contract is available client-side.
 */
export function catalogLocalVisualFor(
  categoryName: string,
  categorySlug: string,
  venueName: string,
  primaryImage?: { url: string; alt: string } | null,
  appOrigin?: string,
): CatalogLocalVisual | null {
  const category = categoryForValues(categoryName, categorySlug);
  if (!category) return null;

  let selected: { path: LocalImagePath; alt: string } | null = null;
  if (primaryImage && appOrigin) {
    try {
      const origin = new URL(appOrigin);
      const candidate = new URL(primaryImage.url, origin);
      const path = candidate.pathname as LocalImagePath;
      if (candidate.origin === origin.origin && path in LOCAL_IMAGE_ASSETS) {
        selected = { path, alt: primaryImage.alt || `Immagine di ${venueName}` };
      }
    } catch {
      // A malformed or remote URL falls through to the local category asset.
    }
  }
  selected ??= {
    path: CATEGORY_IMAGES[category],
    alt: `Immagine illustrativa della categoria ${category.toLocaleLowerCase('it-IT')}`,
  };

  return { ...selected, ...LOCAL_IMAGE_ASSETS[selected.path] };
}

function controlledSelection<T extends string>(values: readonly string[], allowed: readonly T[]) {
  const selected = new Set(values);
  return allowed.filter((value) => selected.has(value));
}

function controlledSemanticQuery(values: readonly string[]) {
  let query = '';
  for (const value of [...new Set(values)].slice(0, CATALOG_CANDIDATE_SEMANTIC_TERM_LIMIT)) {
    const candidate = query ? `${query} OR ${value}` : value;
    if (candidate.length > CATALOG_CANDIDATE_SEMANTIC_QUERY_MAX_LENGTH) break;
    query = candidate;
  }
  return query;
}

/**
 * Builds a constrained candidate expansion request. Only controlled catalog
 * dimensions and allowlisted semantic terms are forwarded to our same-origin
 * catalog endpoint; the user's free-form query is deliberately not accepted.
 */
export function buildCatalogCandidateRequestUrl(
  appOrigin: string,
  intent: CatalogCandidateIntent,
): URL | null {
  let requestUrl: URL;
  try {
    requestUrl = new URL('/api/catalog', appOrigin);
  } catch {
    return null;
  }

  const categorySlugs = [...new Set(intent.categories.flatMap((value) => {
    const category = categoryForValues(value, value);
    return category ? [CATEGORY_QUERY_SLUGS[category]] : [];
  }))].sort().slice(0, 5);
  const controlledNeighborhoods = new Set(controlledSelection(intent.neighborhoods, CONTROLLED_NEIGHBORHOODS));
  const neighborhoodSlugs = [...controlledNeighborhoods].flatMap((value) => {
    const slug = normalise(value).replace(/ /g, '-');
    return slug.length <= 80 && SLUG.test(slug) ? [slug] : [];
  }).sort().slice(0, 8);

  const requiredServices = controlledSelection(intent.requiredServices ?? [], CONTROLLED_SERVICES);
  const requiredDietary = controlledSelection(
    intent.requiredDietaryPreferences ?? [],
    CONTROLLED_DIETARY_PREFERENCES,
  );
  const mappedRequiredConcepts = new Set<ControlledConcept>();
  const serviceSlugs = [...requiredServices, ...requiredDietary].flatMap((value) => {
    const slug = CATALOG_SERVICE_SLUGS[value];
    if (!slug) return [];
    mappedRequiredConcepts.add(value);
    return [slug];
  }).filter((slug, index, slugs) => slugs.indexOf(slug) === index).sort().slice(0, 12);

  const atmosphere = controlledSelection(intent.atmosphere ?? [], CONTROLLED_ATMOSPHERES);
  const occasions = controlledSelection(intent.occasions ?? [], CONTROLLED_OCCASIONS);
  const concepts = controlledSelection(intent.concepts ?? [], CONTROLLED_CONCEPTS)
    .filter((value) => !mappedRequiredConcepts.has(value));
  const semanticQuery = controlledSemanticQuery([...atmosphere, ...occasions, ...concepts]);

  if (!categorySlugs.length && !neighborhoodSlugs.length && !serviceSlugs.length && !semanticQuery) return null;
  requestUrl.searchParams.set('limit', '50');
  requestUrl.searchParams.set('sort', 'quality');
  categorySlugs.forEach((slug) => {
    requestUrl.searchParams.append('category', slug);
  });
  neighborhoodSlugs.forEach((slug) => {
    requestUrl.searchParams.append('neighborhood', slug);
  });
  serviceSlugs.forEach((slug) => {
    requestUrl.searchParams.append('service', slug);
  });
  if (semanticQuery) requestUrl.searchParams.set('q', semanticQuery);
  return requestUrl;
}

/**
 * Follows opaque catalog cursors with a strict request and row budget. A
 * malformed page or a cross-origin initial URL fails closed; a later transient
 * page failure retains already validated pages as a best-effort recall gain.
 */
export async function fetchCatalogCandidatePages(
  initialRequestUrl: string | URL,
  appOrigin: string,
  fetcher: CatalogCandidateFetcher = fetch,
  signal?: AbortSignal,
): Promise<CatalogVenuePayload[]> {
  const initialUrl = new URL(initialRequestUrl);
  const expectedOrigin = new URL(appOrigin).origin;
  if (initialUrl.origin !== expectedOrigin || initialUrl.pathname !== '/api/catalog') {
    throw new Error('catalog_candidates_invalid_endpoint');
  }

  const pages: CatalogVenuePayload[] = [];
  const seenCursors = new Set<string>();
  let summaryCount = 0;
  let requestUrl = new URL(initialUrl);

  for (let requestCount = 0; requestCount < CATALOG_CANDIDATE_MAX_REQUESTS; requestCount += 1) {
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await fetcher(requestUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
        signal,
      });
      if (!response.ok) throw new Error(`catalog_candidates_${response.status}`);
      const payload = parseCatalogVenuePayload(await response.json());
      if (!payload) throw new Error('catalog_candidates_invalid');
      pages.push(payload);
      summaryCount += payload.summaries.length;

      const cursor = payload.pagination.nextCursor;
      if (!payload.pagination.hasMore
        || !cursor
        || summaryCount >= CATALOG_CANDIDATE_MAX_SUMMARIES
        || seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
      requestUrl = new URL(initialUrl);
      requestUrl.searchParams.set('cursor', cursor);
    } catch (error) {
      if (signal?.aborted || pages.length === 0) throw error;
      break;
    }
  }

  return pages;
}

export function catalogSummaryToVenue(
  summary: CatalogVenueSummary,
  generatedAt: string,
  appOrigin?: string,
): Venue | null {
  const category = categoryFor(summary);
  const maturityTier = maturityFor(summary.verification.maturity);
  const verifiedTimestamp = summary.verification.verifiedAt;
  const verifiedAt = verifiedTimestamp?.slice(0, 10) ?? '';
  if (!category
    || !summary.recommendationEligible
    || summary.verification.status !== 'verified'
    || !['Gold', 'Platinum'].includes(maturityTier)
    || summary.verification.confidenceScore < 0.7
    || summary.verification.confidenceScore > 1
    || summary.verification.qualityScore < 0
    || summary.verification.qualityScore > 100
    || !/^\d{4}-\d{2}-\d{2}$/.test(verifiedAt)
    || !isWithinMilanDiscoveryArea(summary.location)) return null;

  const price = priceFor(summary);
  const image = catalogLocalVisualFor(
    summary.category.name,
    summary.category.slug,
    summary.name,
    summary.primaryImage,
    appOrigin,
  );
  if (!image) return null;
  const sessionTravel = estimateSessionWalk(DUOMO_DISCOVERY_ORIGIN, summary.location);
  const concepts = structuredConceptsForServices(summary.services);
  const checkedAt = Number.isFinite(Date.parse(verifiedTimestamp!))
    ? new Date(verifiedTimestamp!).toISOString()
    : `${verifiedAt}T12:00:00.000Z`;
  const confidence = summary.verification.confidenceScore;
  const schedule = scheduleState(summary, generatedAt);

  const venue: Venue = {
    id: summary.id,
    slug: summary.slug,
    name: summary.name.trim(),
    neighborhood: summary.neighborhood?.name.trim() || 'Milano',
    category,
    image: image.path,
    imageAlt: image.alt,
    imageWidth: image.width,
    imageHeight: image.height,
    priceLevel: price.level,
    averageSpend: price.averageSpend,
    pricingKnown: price.known,
    discoveryLocation: summary.location,
    travelEstimate: {
      minutes: sessionTravel.minutes,
      mode: 'walk',
      origin: {
        id: 'milano-duomo-centroid',
        label: 'Duomo, origine della stima',
        shortLabel: 'Duomo',
        ...DUOMO_DISCOVERY_ORIGIN,
      },
      checkedAt: generatedAt,
      validUntil: addDays(generatedAt, 1),
      source: 'editorial',
    },
    provenance: {
      pricing: { source: 'editorial', checkedAt, validUntil: addDays(checkedAt, 90), confidence },
      attributes: { source: 'editorial', checkedAt, validUntil: addDays(checkedAt, 90), confidence },
      imageRights: {
        source: 'editorial',
        checkedAt: generatedAt,
        validUntil: addDays(generatedAt, 180),
        confidence: 1,
        rightsStatus: 'owned',
        rightsHolder: 'TRE Milano — asset locale di fallback',
      },
    },
    // Opening state is derived only from verified, current weekly hours with
    // an official source URL. Missing/stale provenance stays fail-closed.
    openStatus: schedule.openStatus,
    availability: schedule.availability,
    // The reduced public projection has no verified structured values for
    // these dimensions. Empty is intentional and fail-closed.
    atmosphere: [],
    occasions: [],
    features: [...new Set([...summary.services.map(humaniseService), ...concepts])].slice(0, 6),
    semanticTags: [...new Set([
      summary.shortDescription ?? '',
      summary.subcategorySlug ? humaniseService(summary.subcategorySlug) : '',
      summary.formattedAddress,
      ...summary.services.map(humaniseService),
      ...concepts,
    ].filter(Boolean))],
    confidence,
    verifiedAt,
    maturityTier,
    fixtureOnly: false,
    recommendationEligible: summary.recommendationEligible,
    catalogApiRankingEvidence: {
      source: 'catalog-api',
      qualityScore: summary.verification.qualityScore,
      generatedAt,
      travelDisclosure: 'stimata, non routing',
    },
  };
  return isVenueCatalogApiRankingEligible(venue, Date.parse(generatedAt)) ? venue : null;
}

export function catalogPayloadToVenues(payload: CatalogVenuePayload, appOrigin?: string): Venue[] {
  return payload.summaries.flatMap((summary) => {
    const venue = catalogSummaryToVenue(summary, payload.generatedAt, appOrigin);
    return venue ? [venue] : [];
  });
}
