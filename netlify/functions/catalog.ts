import type { Config, Context } from '@netlify/functions';
import { CATALOG_API_VERSION, type CatalogListResponse, type CatalogVenueSummary } from '../../src/domain/catalog-api';
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
  maturity: CatalogVenueSummary['verification']['maturity']; quality_score: number; confidence_score: number;
  verified_at: string | null; distance_meters: number | null; relevance_score: number; sort_value: number;
};

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
        p_after_value: query.cursor?.value ?? null,
        p_after_id: query.cursor?.id ?? null,
        p_limit: query.limit + 1,
      });
      const hasMore = rows.length > query.limit;
      const visible = rows.slice(0, query.limit);
      const data: CatalogVenueSummary[] = visible.map((row) => ({
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
        verification: {
          maturity: row.maturity,
          qualityScore: Number(row.quality_score),
          confidenceScore: Number(row.confidence_score),
          verifiedAt: row.verified_at,
        },
        distanceMeters: row.distance_meters === null ? null : Math.round(row.distance_meters),
      }));
      const last = visible.at(-1);
      const privacySensitive = query.query !== null || query.latitude !== null || query.bbox !== null;
      const cacheSeconds = numberEnv('CATALOG_API_CACHE_SECONDS', 60, { min: 0, max: 3600 });
      const response: CatalogListResponse = {
        version: CATALOG_API_VERSION,
        data,
        pagination: {
          nextCursor: hasMore && last ? encodeCatalogCursor({ value: Number(last.sort_value), id: last.id }) : null,
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
