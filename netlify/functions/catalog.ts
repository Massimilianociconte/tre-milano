import type { Config, Context } from '@netlify/functions';
import {
  CATALOG_API_VERSION,
  type CatalogListResponse,
  type CatalogVerificationStatus,
  type CatalogVenueSummary,
  type CatalogVenueWeeklyHour,
} from '../../src/domain/catalog-api';
import { isPublicHttpsUrl } from '../../src/domain/venue';
import { CatalogQueryError, encodeCatalogCursor, parseCatalogQuery } from '../../src/server/catalog-query';
import { loadSupabaseRuntimeConfig, numberEnv, requiredSecretEnv, RuntimeConfigurationError } from './_shared/env';
import { cacheWindowTimestamp, clientIp, isSameOriginOrServerRequest, json, problem, responseEtag } from './_shared/http';
import { consumeRateLimit } from './_shared/rate-limit';
import { createSupabaseAdminClient, SupabaseRequestError } from './_shared/supabase';

type SearchRow = {
  id: string; slug: string; name: string; short_description: string | null;
  category_slug: string; category_name: string; subcategory_slug: string | null;
  neighborhood_slug: string | null; neighborhood_name: string | null; municipality_id: number | null;
  latitude: number; longitude: number; formatted_address: string;
  price_level: number | null; average_spend_cents: number | null;
  rating: number | null; review_count: number | null; review_source_count: number | null;
  rating_sources: CatalogVenueSummary['ratings'] | null;
  image_url: string | null; image_alt: string | null; service_slugs: string[] | null;
  weekly_hours?: unknown; hours_source_url?: string | null;
  verification_status?: unknown; open_now?: unknown;
  maturity: CatalogVenueSummary['verification']['maturity']; quality_score: number; confidence_score: number;
  verified_at: string | null; published_at?: string | null;
  distance_meters: number | null; relevance_score: number; sort_value: number;
  sort_text?: string | null;
};

type RecommendationEligibilityRow = {
  id: string;
  recommendation_eligible: boolean;
};

type GatedSearchRow = SearchRow & {
  recommendationEligible: boolean;
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const VERIFICATION_STATUSES = new Set<CatalogVerificationStatus>([
  'unverified', 'pending', 'verified', 'disputed', 'rejected',
]);

function parseVerificationStatus(value: unknown): CatalogVerificationStatus | null {
  return typeof value === 'string' && VERIFICATION_STATUSES.has(value as CatalogVerificationStatus)
    ? value as CatalogVerificationStatus
    : null;
}

function parseWeeklyHours(value: unknown): CatalogVenueWeeklyHour[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const weekday = Number(row.weekday);
    const sequence = Number(row.sequence);
    const opensAt = row.opensAt === null ? null : String(row.opensAt ?? '');
    const closesAt = row.closesAt === null ? null : String(row.closesAt ?? '');
    const verifiedAt = String(row.verifiedAt ?? '');
    const validUntil = row.validUntil === null ? null : String(row.validUntil ?? '');
    const closed = row.closed === true;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6
      || !Number.isInteger(sequence) || sequence < 1 || sequence > 8
      || !Number.isFinite(Date.parse(verifiedAt))
      || (validUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil))
      || (closed
        ? opensAt !== null || closesAt !== null
        : !opensAt || !closesAt || !TIME.test(opensAt) || !TIME.test(closesAt))) return [];
    return [{
      weekday,
      sequence,
      opensAt,
      closesAt,
      closesNextDay: row.closesNextDay === true,
      closed,
      verifiedAt: new Date(verifiedAt).toISOString(),
      validUntil,
    }];
  });
}

export function createCatalogHandler() {
  return async (request: Request, context: Context) => {
    if (request.method !== 'GET') return problem(405, 'Metodo non consentito', { requestId: context.requestId });
    if (!isSameOriginOrServerRequest(request)) return problem(403, 'Origine non consentita', { requestId: context.requestId });
    try {
      const query = parseCatalogQuery(new URL(request.url));
      const config = loadSupabaseRuntimeConfig();
      const client = createSupabaseAdminClient({ config });
      const limit = numberEnv('CATALOG_API_RATE_LIMIT', 120, { min: 10, max: 10_000 });
      const rate = await consumeRateLimit({
        client, identifier: clientIp(context), hashSecret: requiredSecretEnv('RATE_LIMIT_HASH_SECRET'),
        route: 'catalog:list', limit, windowSeconds: 60,
      });
      if (!rate.allowed) return problem(429, 'Troppe richieste', {
        requestId: context.requestId, detail: 'Riprova tra poco.', headers: { 'Retry-After': String(rate.retryAfterSeconds) },
      });

      const rows = await client.rpc<SearchRow[]>('search_venues', {
        p_query: query.query,
        p_category_slugs: query.categorySlugs,
        ...(query.subcategorySlugs ? { p_subcategory_slugs: query.subcategorySlugs } : {}),
        p_neighborhood_slugs: query.neighborhoodSlugs,
        p_service_slugs: query.serviceSlugs,
        p_min_price_level: query.minPriceLevel,
        p_max_price_level: query.maxPriceLevel,
        p_latitude: query.latitude,
        p_longitude: query.longitude,
        p_radius_meters: query.radiusMeters,
        p_min_latitude: query.bbox?.[0] ?? null,
        p_min_longitude: query.bbox?.[1] ?? null,
        p_max_latitude: query.bbox?.[2] ?? null,
        p_max_longitude: query.bbox?.[3] ?? null,
        p_sort: query.sort,
        p_after_value: typeof query.cursor?.value === 'number' ? query.cursor.value : null,
        ...(query.sort === 'name' ? {
          p_after_text: typeof query.cursor?.value === 'string' ? query.cursor.value : null,
        } : {}),
        p_after_id: query.cursor?.id ?? null,
        p_limit: query.limit + 1,
        p_include_unverified: query.includeUnverified,
        ...(query.openNow ? { p_open_now: true } : {}),
      });
      const eligibilityRows = rows.length
        ? await client.rpc<RecommendationEligibilityRow[]>('get_venue_recommendation_eligibility', {
            p_venue_ids: rows.map(({ id }) => id),
          })
        : [];
      const eligibilityById = new Map(eligibilityRows.flatMap((row) => (
        typeof row.id === 'string' && typeof row.recommendation_eligible === 'boolean'
          ? [[row.id, row.recommendation_eligible] as const]
          : []
      )));
      const gatedRows: GatedSearchRow[] = rows.map((row) => ({
        ...row,
        // Missing or malformed eligibility is never promoted to a recommendation.
        recommendationEligible: eligibilityById.get(row.id) === true,
      }));
      const visible: GatedSearchRow[] = [];
      let consumedCount = 0;
      let cursorRow: GatedSearchRow | null = null;
      for (const row of gatedRows) {
        consumedCount += 1;
        cursorRow = row;
        if (query.includeUnverified || row.recommendationEligible) visible.push(row);
        if (visible.length === query.limit) break;
      }
      // search_venues returns at most limit + 1. If the gate consumes that
      // whole window while discarding rows, keep a cursor on the last scanned
      // record so the next request advances instead of looping or truncating.
      const hasMore = gatedRows.length > 0 && (
        consumedCount < gatedRows.length || gatedRows.length > query.limit
      );
      const data: CatalogVenueSummary[] = visible.map((row) => {
        const hoursSourceUrl = typeof row.hours_source_url === 'string' && isPublicHttpsUrl(row.hours_source_url)
          ? row.hours_source_url
          : null;
        return {
          id: row.id,
          slug: row.slug,
          name: row.name,
          shortDescription: row.short_description,
          category: { slug: row.category_slug, name: row.category_name },
          subcategorySlug: row.subcategory_slug,
          neighborhood: row.neighborhood_slug && row.neighborhood_name
            ? { slug: row.neighborhood_slug, name: row.neighborhood_name } : null,
          municipality: row.municipality_id,
          location: { latitude: row.latitude, longitude: row.longitude },
          formattedAddress: row.formatted_address,
          price: { level: row.price_level, averageSpendCents: row.average_spend_cents, currency: 'EUR' },
          ratings: Array.isArray(row.rating_sources) ? row.rating_sources.map((rating) => ({
            ...rating,
            value: Number(rating.value), scale: Number(rating.scale), count: Number(rating.count),
          })) : [],
          primaryImage: row.image_url && row.image_alt ? {
            url: row.image_url.startsWith('/storage/v1/')
              ? `${config.url}${row.image_url}`
              : row.image_url.startsWith('/') ? new URL(row.image_url, request.url).toString() : row.image_url,
            alt: row.image_alt,
          } : null,
          services: row.service_slugs || [],
          weeklyHours: hoursSourceUrl ? parseWeeklyHours(row.weekly_hours) : [],
          hoursSourceUrl,
          verification: {
            status: parseVerificationStatus(row.verification_status),
            maturity: row.maturity,
            qualityScore: Number(row.quality_score),
            confidenceScore: Number(row.confidence_score),
            verifiedAt: row.verified_at,
          },
          recommendationEligible: row.recommendationEligible,
          openNow: row.open_now === true,
          distanceMeters: row.distance_meters === null ? null : Math.round(row.distance_meters),
        };
      });
      const privacySensitive = query.query !== null || query.latitude !== null || query.bbox !== null || query.openNow;
      const cacheSeconds = numberEnv('CATALOG_API_CACHE_SECONDS', 60, { min: 0, max: 3600 });
      const response: CatalogListResponse = {
        version: CATALOG_API_VERSION,
        data,
        pagination: {
          nextCursor: hasMore && cursorRow ? encodeCatalogCursor({
            value: query.sort === 'name' ? String(cursorRow.sort_text) : Number(cursorRow.sort_value),
            id: cursorRow.id,
            sort: query.sort,
          }) : null,
          limit: query.limit,
          hasMore,
        },
        // A cacheable representation must remain byte-for-byte stable while its
        // CDN cache window is active, otherwise If-None-Match can never produce
        // a meaningful 304. Private query/geo responses are never assigned an
        // ETag, so they retain their actual generation time.
        meta: {
          sort: query.sort,
          generatedAt: privacySensitive
            ? new Date().toISOString()
            : cacheWindowTimestamp(cacheSeconds),
        },
      };
      const etag = privacySensitive ? null : await responseEtag(response);
      const headers = new Headers({
        Vary: 'Origin, Accept-Encoding',
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(Math.max(0, limit - rate.count)),
      });
      if (privacySensitive) headers.set('Cache-Control', 'private, no-store, max-age=0');
      else {
        headers.set('ETag', etag as string);
        headers.set('Cache-Control', `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`);
        headers.set('Netlify-CDN-Cache-Control', `public, durable, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`);
      }
      if (etag && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
      return json(response, 200, headers);
    } catch (error) {
      if (error instanceof CatalogQueryError) return problem(400, 'Parametri non validi', { detail: error.message, requestId: context.requestId });
      if (error instanceof RuntimeConfigurationError) return problem(503, 'Catalogo non configurato', { requestId: context.requestId });
      if (error instanceof SupabaseRequestError) return problem(error.status === 504 ? 504 : 503, 'Catalogo temporaneamente non disponibile', { requestId: context.requestId });
      return problem(500, 'Errore interno', { requestId: context.requestId });
    }
  };
}

export default createCatalogHandler();

export const config: Config = {
  path: '/api/catalog',
  method: 'GET',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 180 },
};
