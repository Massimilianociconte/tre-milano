import type { Config, Context } from '@netlify/functions';
import { CATALOG_API_VERSION } from '../../src/domain/catalog-api';
import { loadSupabaseRuntimeConfig, numberEnv, requiredSecretEnv, RuntimeConfigurationError } from './_shared/env';
import { clientIp, isSameOriginOrServerRequest, json, problem, responseEtag } from './_shared/http';
import { consumeRateLimit } from './_shared/rate-limit';
import { createSupabaseAdminClient, SupabaseRequestError } from './_shared/supabase';

export default async (request: Request, context: Context) => {
  if (request.method !== 'GET') return problem(405, 'Metodo non consentito', { requestId: context.requestId });
  if (!isSameOriginOrServerRequest(request)) return problem(403, 'Origine non consentita', { requestId: context.requestId });
  try {
    const url = new URL(request.url);
    const bbox = url.searchParams.get('bbox')?.split(',').map(Number) || [];
    if (bbox.length && (bbox.length !== 4 || bbox.some((value) => !Number.isFinite(value)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3])) {
      return problem(400, 'Bounding box non valida', { requestId: context.requestId });
    }
    const client = createSupabaseAdminClient({ config: loadSupabaseRuntimeConfig() });
    const limit = numberEnv('CATALOG_API_RATE_LIMIT', 120, { min: 10, max: 10_000 });
    const rate = await consumeRateLimit({
      client, identifier: clientIp(context), hashSecret: requiredSecretEnv('RATE_LIMIT_HASH_SECRET'),
      route: 'catalog:facets', limit, windowSeconds: 60,
    });
    if (!rate.allowed) return problem(429, 'Troppe richieste', { requestId: context.requestId, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
    const facetParameters = {
      p_min_latitude: bbox[1] ?? null, p_min_longitude: bbox[0] ?? null,
      p_max_latitude: bbox[3] ?? null, p_max_longitude: bbox[2] ?? null,
      // This endpoint powers Explore, whose list explicitly requests the
      // browse-only Bronze catalog with include_unverified=1.
      p_include_unverified: true,
    };
    let facets: Record<string, unknown>;
    try {
      facets = await client.rpc<Record<string, unknown>>('catalog_facets', facetParameters);
    } catch (error) {
      // Rolling-deploy safety: code may reach the CDN just before the versioned
      // migration. Only the exact PostgREST signature-miss falls back; database
      // and authorization failures still fail closed.
      if (!(error instanceof SupabaseRequestError) || error.code !== 'PGRST202') throw error;
      const { p_include_unverified: _includeUnverified, ...legacyParameters } = facetParameters;
      facets = await client.rpc<Record<string, unknown>>('catalog_facets', legacyParameters);
    }
    const cacheSeconds = numberEnv('CATALOG_API_CACHE_SECONDS', 60, { min: 0, max: 3600 });
    const response = { version: CATALOG_API_VERSION, data: facets };
    const etag = bbox.length ? null : await responseEtag(response);
    const headers = new Headers({
      Vary: 'Origin, Accept-Encoding',
      'Cache-Control': bbox.length
        ? 'private, no-store, max-age=0'
        : `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`,
    });
    if (etag) {
      headers.set('ETag', etag);
      headers.set('Netlify-CDN-Cache-Control', `public, durable, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`);
    }
    if (etag && request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
    return json(response, 200, headers);
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) return problem(503, 'Catalogo non configurato', { requestId: context.requestId });
    if (error instanceof SupabaseRequestError) return problem(503, 'Catalogo temporaneamente non disponibile', { requestId: context.requestId });
    return problem(500, 'Errore interno', { requestId: context.requestId });
  }
};

export const config: Config = {
  path: '/api/catalog/facets', method: 'GET',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 180 },
};
