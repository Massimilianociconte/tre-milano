import type { Config, Context } from '@netlify/functions';
import { CATALOG_API_VERSION, type CatalogDetailResponse } from '../../src/domain/catalog-api';
import { loadSupabaseRuntimeConfig, numberEnv, requiredSecretEnv, RuntimeConfigurationError } from './_shared/env';
import { clientIp, isSameOriginOrServerRequest, json, problem, responseEtag } from './_shared/http';
import { consumeRateLimit } from './_shared/rate-limit';
import { createSupabaseAdminClient, SupabaseRequestError } from './_shared/supabase';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export default async (request: Request, context: Context) => {
  if (request.method !== 'GET') return problem(405, 'Metodo non consentito', { requestId: context.requestId });
  if (!isSameOriginOrServerRequest(request)) return problem(403, 'Origine non consentita', { requestId: context.requestId });
  const slug = context.params.slug;
  if (!slug || slug.length > 180 || !SLUG.test(slug)) return problem(400, 'Identificatore locale non valido', { requestId: context.requestId });
  try {
    const config = loadSupabaseRuntimeConfig();
    const client = createSupabaseAdminClient({ config });
    const limit = numberEnv('CATALOG_API_RATE_LIMIT', 120, { min: 10, max: 10_000 });
    const rate = await consumeRateLimit({
      client, identifier: clientIp(context), hashSecret: requiredSecretEnv('RATE_LIMIT_HASH_SECRET'),
      route: 'catalog:detail', limit, windowSeconds: 60,
    });
    if (!rate.allowed) return problem(429, 'Troppe richieste', { requestId: context.requestId, headers: { 'Retry-After': String(rate.retryAfterSeconds) } });
    const detail = await client.rpc<Record<string, unknown> | null>('get_venue_detail', { p_slug: slug });
    if (!detail) return problem(404, 'Locale non trovato', { requestId: context.requestId });
    const response: CatalogDetailResponse = { version: CATALOG_API_VERSION, data: detail };
    const etag = await responseEtag(response);
    const cacheSeconds = numberEnv('CATALOG_API_CACHE_SECONDS', 60, { min: 0, max: 3600 });
    const headers = new Headers({
      ETag: etag,
      Vary: 'Origin, Accept-Encoding',
      'Cache-Control': `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`,
      'Netlify-CDN-Cache-Control': `public, durable, max-age=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 5}`,
    });
    if (request.headers.get('if-none-match') === etag) return new Response(null, {
      status: 304,
      headers,
    });
    return json(response, 200, headers);
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) return problem(503, 'Catalogo non configurato', { requestId: context.requestId });
    if (error instanceof SupabaseRequestError) return problem(error.status === 504 ? 504 : 503, 'Catalogo temporaneamente non disponibile', { requestId: context.requestId });
    return problem(500, 'Errore interno', { requestId: context.requestId });
  }
};

export const config: Config = {
  path: '/api/venues/:slug',
  method: 'GET',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 180 },
};
