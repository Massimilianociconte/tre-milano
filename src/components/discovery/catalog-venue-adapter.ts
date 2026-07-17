import {
  CATALOG_API_VERSION,
  type CatalogVenueSummary,
} from '../../domain/catalog-api';
import {
  CONTROLLED_ATMOSPHERES,
  CONTROLLED_CONCEPTS,
  CONTROLLED_OCCASIONS,
} from '../../search/interpretation-contract';
import {
  DUOMO_DISCOVERY_ORIGIN,
  estimateSessionWalk,
  isWithinMilanDiscoveryArea,
} from '../../domain/discovery-location';
import {
  isVenueCatalogApiRankingEligible,
  type PriceLevel,
  type Venue,
  type VenueCategory,
  type VenueMaturityTier,
} from '../../domain/venue';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

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
    || !isRecord(value.verification)
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
    || !isRecord(value.meta)
    || typeof value.meta.generatedAt !== 'string'
    || !Number.isFinite(Date.parse(value.meta.generatedAt))) return null;

  return {
    generatedAt: value.meta.generatedAt,
    summaries: value.data.filter(isCatalogVenueSummary),
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

function humaniseService(value: string) {
  return value.replace(/[-_]+/g, ' ').trim();
}

function matchedControlledValues<T extends string>(text: string, values: readonly T[]) {
  const haystack = ` ${normalise(text)} `;
  return values.filter((value) => haystack.includes(` ${normalise(value)} `));
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

/**
 * Builds a constrained candidate expansion request. Only controlled catalog
 * dimensions are forwarded; the user's free-form query never leaves the
 * ranking/search interpretation boundary through this endpoint.
 */
export function buildCatalogCandidateRequestUrl(
  appOrigin: string,
  categories: readonly string[],
  neighborhoods: readonly string[],
): URL | null {
  let requestUrl: URL;
  try {
    requestUrl = new URL('/api/catalog', appOrigin);
  } catch {
    return null;
  }

  const categorySlugs = [...new Set(categories.flatMap((value) => {
    const category = categoryForValues(value, value);
    return category ? [CATEGORY_QUERY_SLUGS[category]] : [];
  }))].slice(0, 5);
  const neighborhoodSlugs = [...new Set(neighborhoods.flatMap((value) => {
    if (!/^[\p{L}\p{N}][\p{L}\p{N}\s’'-]{0,79}$/u.test(value.trim())) return [];
    const slug = normalise(value).replace(/ /g, '-');
    return slug.length <= 80 && SLUG.test(slug) ? [slug] : [];
  }))].slice(0, 8);

  if (!categorySlugs.length && !neighborhoodSlugs.length) return null;
  requestUrl.searchParams.set('limit', '50');
  requestUrl.searchParams.set('sort', 'quality');
  categorySlugs.forEach((slug) => {
    requestUrl.searchParams.append('category', slug);
  });
  neighborhoodSlugs.forEach((slug) => {
    requestUrl.searchParams.append('neighborhood', slug);
  });
  return requestUrl;
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
  const searchableText = [
    summary.shortDescription ?? '',
    summary.formattedAddress,
    ...summary.services.map(humaniseService),
  ].join(' ');
  const atmosphere = matchedControlledValues(searchableText, CONTROLLED_ATMOSPHERES);
  const occasions = matchedControlledValues(searchableText, CONTROLLED_OCCASIONS);
  const concepts = matchedControlledValues(searchableText, CONTROLLED_CONCEPTS);
  const checkedAt = Number.isFinite(Date.parse(verifiedTimestamp!))
    ? new Date(verifiedTimestamp!).toISOString()
    : `${verifiedAt}T12:00:00.000Z`;
  const confidence = summary.verification.confidenceScore;

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
    // The reduced list projection has no verified live opening state. Unknown
    // remains fail-closed for "aperto ora" and scheduled-time constraints.
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
    atmosphere,
    occasions,
    features: [...new Set([...summary.services.map(humaniseService), ...concepts])].slice(0, 6),
    semanticTags: [...new Set([
      summary.shortDescription ?? '',
      summary.formattedAddress,
      ...summary.services.map(humaniseService),
      ...concepts,
    ].filter(Boolean))],
    confidence,
    verifiedAt,
    maturityTier,
    fixtureOnly: false,
    recommendationEligible: true,
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
