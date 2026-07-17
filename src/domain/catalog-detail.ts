import { CATALOG_API_VERSION } from './catalog-api';
import { isValidMilanPublicationGeo } from './venue';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const MATURITY = new Set(['bronze', 'silver', 'gold', 'platinum']);
const IMAGE_RIGHTS = new Set(['owned', 'licensed', 'official_permission', 'open_license']);

export type CatalogVenueContact = {
  kind: string;
  value: string;
  official: boolean;
  primary: boolean;
};

export type CatalogVenueHour = {
  weekday: number;
  sequence: number;
  opensAt: string | null;
  closesAt: string | null;
  closesNextDay: boolean;
  closed: boolean;
};

export type CatalogVenueHourException = Omit<CatalogVenueHour, 'weekday'> & {
  date: string;
  note: string | null;
};

export type CatalogVenueDetail = {
  id: string;
  slug: string;
  name: string;
  officialName: string | null;
  description: string | null;
  shortDescription: string | null;
  category: { slug: string; name: string };
  subcategory: { slug: string; name: string } | null;
  status: string;
  verification: {
    status: string;
    maturity: 'bronze' | 'silver' | 'gold' | 'platinum';
    qualityScore: number;
    completenessScore: number;
    confidenceScore: number;
    verifiedAt: string;
    staleAfter: string | null;
  };
  address: {
    formatted: string;
    streetName: string | null;
    streetNumber: string | null;
    postalCode: string | null;
    locality: string | null;
    municipality: number | null;
    neighborhood: { slug: string; name: string } | null;
    latitude: number;
    longitude: number;
  };
  price: {
    currency: 'EUR';
    level: number | null;
    averageSpendCents: number | null;
    minimumSpendCents: number | null;
    maximumSpendCents: number | null;
    note: string | null;
    verifiedAt: string | null;
    validUntil: string | null;
  } | null;
  contacts: CatalogVenueContact[];
  weeklyHours: CatalogVenueHour[];
  hourExceptions: CatalogVenueHourException[];
  services: Array<{ slug: string; name: string }>;
  images: Array<{
    url: string;
    alt: string;
    caption: string | null;
    width: number | null;
    height: number | null;
    rights: string;
    rightsHolder: string | null;
    attribution: string | null;
  }>;
  ratings: Array<{
    source: string;
    rating: number;
    scale: number;
    reviewCount: number;
    observedAt: string;
    sourceUrl: string | null;
  }>;
  sources: Array<{
    name: string;
    kind: string;
    url: string | null;
    license: string | null;
    licenseUrl: string | null;
    attribution: string | null;
    lastObservedAt: string | null;
  }>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const isFiniteNumber = (value: unknown): value is number => (
  typeof value === 'number' && Number.isFinite(value)
);

const text = (value: unknown, maximum = 5_000) => (
  typeof value === 'string' && value.trim() && value.trim().length <= maximum
    ? value.trim()
    : null
);

const nullableText = (value: unknown, maximum = 5_000) => (
  value === null || value === undefined ? null : text(value, maximum)
);

const isTimestamp = (value: unknown): value is string => (
  typeof value === 'string' && Number.isFinite(Date.parse(value))
);

const nullableTimestamp = (value: unknown) => (
  value === null || value === undefined ? null : isTimestamp(value) ? value : undefined
);

const nullableMoney = (value: unknown) => (
  value === null || value === undefined
    ? null
    : Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10_000_000
      ? value as number
      : undefined
);

function parseNamedSlug(value: unknown): { slug: string; name: string } | null {
  if (!isRecord(value)) return null;
  const slug = text(value.slug, 180);
  const name = text(value.name, 240);
  return slug && SLUG.test(slug) && name ? { slug, name } : null;
}

function parseNullableNamedSlug(value: unknown): { slug: string; name: string } | null | undefined {
  if (value === null || value === undefined) return null;
  return parseNamedSlug(value) ?? undefined;
}

function parsePrice(value: unknown): CatalogVenueDetail['price'] | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value) || value.currency !== 'EUR') return undefined;
  const level = value.level === null || value.level === undefined
    ? null
    : Number.isInteger(value.level) && (value.level as number) >= 1 && (value.level as number) <= 4
      ? value.level as number
      : undefined;
  const averageSpendCents = nullableMoney(value.averageSpendCents);
  const minimumSpendCents = nullableMoney(value.minimumSpendCents);
  const maximumSpendCents = nullableMoney(value.maximumSpendCents);
  const verifiedAt = nullableTimestamp(value.verifiedAt);
  const validUntil = nullableTimestamp(value.validUntil);
  if ([level, averageSpendCents, minimumSpendCents, maximumSpendCents, verifiedAt, validUntil].includes(undefined)) {
    return undefined;
  }
  return {
    currency: 'EUR',
    level: level as number | null,
    averageSpendCents: averageSpendCents as number | null,
    minimumSpendCents: minimumSpendCents as number | null,
    maximumSpendCents: maximumSpendCents as number | null,
    note: nullableText(value.note, 500),
    verifiedAt: verifiedAt as string | null,
    validUntil: validUntil as string | null,
  };
}

function parseHour(value: unknown): CatalogVenueHour | null {
  if (!isRecord(value)
    || !Number.isInteger(value.weekday)
    || (value.weekday as number) < 0
    || (value.weekday as number) > 6
    || !Number.isInteger(value.sequence)
    || (value.sequence as number) < 1
    || typeof value.closed !== 'boolean'
    || typeof value.closesNextDay !== 'boolean') return null;
  const opensAt = value.opensAt === null ? null : text(value.opensAt, 8);
  const closesAt = value.closesAt === null ? null : text(value.closesAt, 8);
  if ((opensAt !== null && !TIME.test(opensAt)) || (closesAt !== null && !TIME.test(closesAt))) return null;
  if (!value.closed && (!opensAt || !closesAt)) return null;
  return {
    weekday: value.weekday as number,
    sequence: value.sequence as number,
    opensAt,
    closesAt,
    closesNextDay: value.closesNextDay,
    closed: value.closed,
  };
}

function parseHourException(value: unknown): CatalogVenueHourException | null {
  if (!isRecord(value) || typeof value.date !== 'string' || !DATE.test(value.date)) return null;
  const parsed = parseHour({ ...value, weekday: 0 });
  if (!parsed) return null;
  const { weekday: _weekday, ...hour } = parsed;
  return { ...hour, date: value.date, note: nullableText(value.note, 300) };
}

function parseContact(value: unknown): CatalogVenueContact | null {
  if (!isRecord(value) || typeof value.official !== 'boolean' || typeof value.primary !== 'boolean') return null;
  const kind = text(value.kind, 40);
  const contactValue = text(value.value, 500);
  return kind && contactValue ? { kind, value: contactValue, official: value.official, primary: value.primary } : null;
}

function parseService(value: unknown): CatalogVenueDetail['services'][number] | null {
  const parsed = parseNamedSlug(value);
  return parsed ? { slug: parsed.slug, name: parsed.name } : null;
}

function parseImage(value: unknown): CatalogVenueDetail['images'][number] | null {
  if (!isRecord(value)) return null;
  const url = text(value.url, 2_000);
  const alt = text(value.alt, 500);
  const rights = text(value.rights, 80);
  const width = value.width === null || value.width === undefined
    ? null
    : Number.isInteger(value.width) && (value.width as number) > 0 ? value.width as number : undefined;
  const height = value.height === null || value.height === undefined
    ? null
    : Number.isInteger(value.height) && (value.height as number) > 0 ? value.height as number : undefined;
  if (!url || !alt || !rights || !IMAGE_RIGHTS.has(rights) || width === undefined || height === undefined) return null;
  return {
    url,
    alt,
    caption: nullableText(value.caption, 700),
    width,
    height,
    rights,
    rightsHolder: nullableText(value.rightsHolder, 300),
    attribution: nullableText(value.attribution, 700),
  };
}

function parseRating(value: unknown): CatalogVenueDetail['ratings'][number] | null {
  if (!isRecord(value)) return null;
  const source = text(value.source, 240);
  const observedAt = isTimestamp(value.observedAt) ? value.observedAt : null;
  const sourceUrl = nullableText(value.sourceUrl, 2_000);
  if (!source || !observedAt
    || !isFiniteNumber(value.rating)
    || !isFiniteNumber(value.scale)
    || value.scale <= 0
    || value.rating < 0
    || value.rating > value.scale
    || !Number.isInteger(value.reviewCount)
    || (value.reviewCount as number) < 0) return null;
  return {
    source,
    rating: value.rating,
    scale: value.scale,
    reviewCount: value.reviewCount as number,
    observedAt,
    sourceUrl,
  };
}

function parseSource(value: unknown): CatalogVenueDetail['sources'][number] | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, 240);
  const kind = text(value.kind, 80);
  const lastObservedAt = nullableTimestamp(value.lastObservedAt);
  if (!name || !kind || lastObservedAt === undefined) return null;
  return {
    name,
    kind,
    url: nullableText(value.url, 2_000),
    license: nullableText(value.license, 300),
    licenseUrl: nullableText(value.licenseUrl, 2_000),
    attribution: nullableText(value.attribution, 700),
    lastObservedAt,
  };
}

/**
 * Runtime boundary for the service-only detail RPC projection. Required
 * identity, publication and geospatial fields fail closed; optional repeated
 * records are independently filtered so one malformed source row cannot make
 * an otherwise valid venue unusable.
 */
export function parseCatalogDetailResponse(value: unknown): CatalogVenueDetail | null {
  if (!isRecord(value) || value.version !== CATALOG_API_VERSION || !isRecord(value.data)) return null;
  const data = value.data;
  const id = text(data.id, 180);
  const slug = text(data.slug, 180);
  const name = text(data.name, 240);
  const category = parseNamedSlug(data.category);
  const subcategory = parseNullableNamedSlug(data.subcategory);
  const status = text(data.status, 80);
  const verification = isRecord(data.verification) ? data.verification : null;
  const address = isRecord(data.address) ? data.address : null;
  const neighborhood = address ? parseNullableNamedSlug(address.neighborhood) : null;
  const price = parsePrice(data.price);

  if (!id || !slug || !SLUG.test(slug) || !name || !category || subcategory === undefined || !status
    || !verification || !address || neighborhood === undefined || price === undefined
    || !text(verification.status, 80)
    || !MATURITY.has(String(verification.maturity))
    || !isFiniteNumber(verification.qualityScore)
    || verification.qualityScore < 0 || verification.qualityScore > 100
    || !isFiniteNumber(verification.completenessScore)
    || verification.completenessScore < 0 || verification.completenessScore > 100
    || !isFiniteNumber(verification.confidenceScore)
    || verification.confidenceScore < 0 || verification.confidenceScore > 1
    || !isTimestamp(verification.verifiedAt)
    || nullableTimestamp(verification.staleAfter) === undefined
    || !text(address.formatted, 500)
    || !isValidMilanPublicationGeo({ latitude: address.latitude, longitude: address.longitude })) return null;

  const municipality = address.municipality === null || address.municipality === undefined
    ? null
    : Number.isInteger(address.municipality) && (address.municipality as number) >= 1
      ? address.municipality as number
      : undefined;
  if (municipality === undefined) return null;

  return {
    id,
    slug,
    name,
    officialName: nullableText(data.officialName, 240),
    description: nullableText(data.description, 10_000),
    shortDescription: nullableText(data.shortDescription, 1_000),
    category,
    subcategory,
    status,
    verification: {
      status: text(verification.status, 80) as string,
      maturity: verification.maturity as CatalogVenueDetail['verification']['maturity'],
      qualityScore: verification.qualityScore,
      completenessScore: verification.completenessScore,
      confidenceScore: verification.confidenceScore,
      verifiedAt: verification.verifiedAt,
      staleAfter: nullableTimestamp(verification.staleAfter) as string | null,
    },
    address: {
      formatted: text(address.formatted, 500) as string,
      streetName: nullableText(address.streetName, 240),
      streetNumber: nullableText(address.streetNumber, 40),
      postalCode: nullableText(address.postalCode, 20),
      locality: nullableText(address.locality, 120),
      municipality,
      neighborhood,
      latitude: address.latitude as number,
      longitude: address.longitude as number,
    },
    price,
    contacts: Array.isArray(data.contacts) ? data.contacts.flatMap((item) => parseContact(item) ?? []) : [],
    weeklyHours: Array.isArray(data.weeklyHours) ? data.weeklyHours.flatMap((item) => parseHour(item) ?? []) : [],
    hourExceptions: Array.isArray(data.hourExceptions) ? data.hourExceptions.flatMap((item) => parseHourException(item) ?? []) : [],
    services: Array.isArray(data.services) ? data.services.flatMap((item) => parseService(item) ?? []) : [],
    images: Array.isArray(data.images) ? data.images.flatMap((item) => parseImage(item) ?? []) : [],
    ratings: Array.isArray(data.ratings) ? data.ratings.flatMap((item) => parseRating(item) ?? []) : [],
    sources: Array.isArray(data.sources) ? data.sources.flatMap((item) => parseSource(item) ?? []) : [],
  };
}
