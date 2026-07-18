import type { Config, Context } from '@netlify/functions';
import { parseIntent } from '../../src/ranking/rank';
import {
  DEEPSEEK_INTERPRETER_MODEL,
  type DeepSeekInterpretationResult,
  type DeepSeekTokenUsage,
  requestDeepSeekInterpretation,
  SearchInterpreterFailure,
} from '../../src/search/deepseek-interpreter';
import {
  hasPromptInjectionRisk,
  hasSearchPrivacyRisk,
  interpretationFromLocalIntent,
  isInterpretedSearchIntentV1,
  type RemoteIntentPayloadV1,
  reconcileRemoteIntent,
  sanitizeSearchQueryForRemote,
  SEARCH_INTERPRETATION_VERSION,
  type SearchInterpretationErrorV1,
  type SearchInterpretationFallbackReason,
  type SearchInterpretationResponseV1,
  shouldUseRemoteInterpretation,
  validateSearchQuery,
} from '../../src/search/interpretation-contract';
import { numberEnv, serverEnv } from './_shared/env';

const REQUEST_MAX_BYTES = 2_048;
const API_PATH = '/api/search/interpret';
const DEFAULT_CACHE_TTL_SECONDS = 300;
const DEFAULT_CACHE_MAX_ENTRIES = 200;

type InterpretationCacheEntry = {
  intent: RemoteIntentPayloadV1;
  expiresAt: number;
};

export type SearchInterpretationRuntimeCache = {
  responses: Map<string, InterpretationCacheEntry>;
  inFlight: Map<string, Promise<DeepSeekInterpretationResult>>;
};

type InterpretationCacheStatus = 'bypass' | 'disabled' | 'hit' | 'miss' | 'in_flight';

type InterpretationLogEvent = {
  event: 'search_interpretation';
  source: 'deepseek' | 'deterministic-fallback';
  fallbackReason: SearchInterpretationFallbackReason | null;
  cache: InterpretationCacheStatus;
  attempts: number;
  latencyMs: number;
  usage: DeepSeekTokenUsage | null;
  requestId?: string;
};

class RuntimeInterpretationFailure extends Error {
  readonly reason: SearchInterpretationFallbackReason;
  readonly cacheStatus: InterpretationCacheStatus;
  readonly attempts: number;
  readonly usage: DeepSeekTokenUsage | null;

  constructor(error: unknown, cacheStatus: InterpretationCacheStatus, accountProviderCost: boolean) {
    super('Runtime search interpretation failed.');
    this.name = 'RuntimeInterpretationFailure';
    this.reason = error instanceof SearchInterpreterFailure ? error.reason : 'upstream_unavailable';
    this.cacheStatus = cacheStatus;
    this.attempts = accountProviderCost && error instanceof SearchInterpreterFailure ? error.attempts : 0;
    this.usage = accountProviderCost && error instanceof SearchInterpreterFailure ? error.usage : null;
  }
}

export function createSearchInterpretationRuntimeCache(): SearchInterpretationRuntimeCache {
  return { responses: new Map(), inFlight: new Map() };
}

const sharedRuntimeCache = createSearchInterpretationRuntimeCache();

type HandlerDependencies = {
  fetchImpl?: typeof fetch;
  getApiKey?: () => string | undefined;
  now?: () => Date;
  clockMs?: () => number;
  getCacheTtlSeconds?: () => number;
  getCacheMaxEntries?: () => number;
  runtimeCache?: SearchInterpretationRuntimeCache;
  log?: (event: InterpretationLogEvent) => void;
};

const responseHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  Vary: 'Origin',
};

function jsonResponse(value: SearchInterpretationResponseV1 | SearchInterpretationErrorV1, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: responseHeaders });
}

function errorResponse(error: SearchInterpretationErrorV1['error'], status: number) {
  const response = jsonResponse({ version: SEARCH_INTERPRETATION_VERSION, error }, status);
  if (status === 405) response.headers.set('Allow', 'POST');
  return response;
}

function fallbackResponse(
  intent: ReturnType<typeof interpretationFromLocalIntent>,
  fallbackReason: SearchInterpretationFallbackReason,
) {
  return jsonResponse({
    version: SEARCH_INTERPRETATION_VERSION,
    source: 'deterministic-fallback',
    interpreter: { provider: 'deepseek', model: DEEPSEEK_INTERPRETER_MODEL },
    intent,
    fallbackReason,
  });
}

function requestIsSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin) return false;
  try {
    if (new URL(origin).origin !== new URL(request.url).origin) return false;
  } catch {
    return false;
  }
  return fetchSite === null || fetchSite === 'same-origin';
}

async function readQuery(request: Request) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > REQUEST_MAX_BYTES) return { error: 'too_large' as const };
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > REQUEST_MAX_BYTES) return { error: 'too_large' as const };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { error: 'invalid' as const };
  }
  if (!parsed
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || Object.keys(parsed).length !== 2
    || !('version' in parsed)
    || !('query' in parsed)
    || (parsed as { version?: unknown }).version !== SEARCH_INTERPRETATION_VERSION) {
    return { error: 'invalid' as const };
  }
  const validated = validateSearchQuery((parsed as { query?: unknown }).query);
  return validated.ok ? { query: validated.query } : { error: 'invalid' as const };
}

function canonicalQuery(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('it-IT')
    .replace(/[’`]/g, "'")
    .replace(/\s*([,;:.!?])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function romeDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get('year')}-${byType.get('month')}-${byType.get('day')}`;
}

async function interpretationCacheKey(query: string, referenceDate: Date) {
  const input = `${SEARCH_INTERPRETATION_VERSION}\n${DEEPSEEK_INTERPRETER_MODEL}\n${romeDateKey(referenceDate)}\n${canonicalQuery(query)}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pruneCache(cache: SearchInterpretationRuntimeCache, nowMs: number, maximumEntries: number) {
  cache.responses.forEach((entry, key) => {
    if (entry.expiresAt <= nowMs) cache.responses.delete(key);
  });
  while (cache.responses.size > maximumEntries) {
    const oldest = cache.responses.keys().next().value;
    if (oldest === undefined) break;
    cache.responses.delete(oldest);
  }
}

async function loadRemoteInterpretation({
  cache,
  key,
  ttlSeconds,
  maximumEntries,
  nowMs,
  request,
}: {
  cache: SearchInterpretationRuntimeCache;
  key: string;
  ttlSeconds: number;
  maximumEntries: number;
  nowMs: number;
  request: () => Promise<DeepSeekInterpretationResult>;
}): Promise<DeepSeekInterpretationResult & { cacheStatus: InterpretationCacheStatus }> {
  pruneCache(cache, nowMs, maximumEntries);
  if (ttlSeconds > 0) {
    const cached = cache.responses.get(key);
    if (cached && cached.expiresAt > nowMs) {
      cache.responses.delete(key);
      cache.responses.set(key, cached);
      return { intent: cached.intent, usage: null, attempts: 0, cacheStatus: 'hit' };
    }
  }

  const pending = cache.inFlight.get(key);
  if (pending) {
    try {
      const result = await pending;
      return { intent: result.intent, usage: null, attempts: 0, cacheStatus: 'in_flight' };
    } catch (error) {
      throw new RuntimeInterpretationFailure(error, 'in_flight', false);
    }
  }

  const currentRequest = request();
  cache.inFlight.set(key, currentRequest);
  try {
    const result = await currentRequest;
    if (ttlSeconds > 0) {
      cache.responses.set(key, {
        intent: result.intent,
        expiresAt: nowMs + ttlSeconds * 1_000,
      });
      pruneCache(cache, nowMs, maximumEntries);
    }
    return { ...result, cacheStatus: ttlSeconds > 0 ? 'miss' : 'disabled' };
  } catch (error) {
    throw new RuntimeInterpretationFailure(error, ttlSeconds > 0 ? 'miss' : 'disabled', true);
  } finally {
    if (cache.inFlight.get(key) === currentRequest) cache.inFlight.delete(key);
  }
}

function productionLog(event: InterpretationLogEvent) {
  console.info(JSON.stringify(event));
}

export function createInterpretSearchHandler({
  fetchImpl = fetch,
  getApiKey = () => serverEnv('DEEPSEEK_API_KEY'),
  now = () => new Date(),
  clockMs = Date.now,
  getCacheTtlSeconds = () => numberEnv(
    'DEEPSEEK_INTERPRETER_CACHE_TTL_SECONDS',
    DEFAULT_CACHE_TTL_SECONDS,
    { min: 0, max: 3_600 },
  ),
  getCacheMaxEntries = () => numberEnv(
    'DEEPSEEK_INTERPRETER_CACHE_MAX_ENTRIES',
    DEFAULT_CACHE_MAX_ENTRIES,
    { min: 10, max: 1_000 },
  ),
  runtimeCache = sharedRuntimeCache,
  log = () => undefined,
}: HandlerDependencies = {}) {
  return async (request: Request, context?: Context) => {
    if (request.method !== 'POST') return errorResponse('method_not_allowed', 405);
    if (!requestIsSameOrigin(request)) return errorResponse('forbidden_origin', 403);
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLocaleLowerCase('en-US') !== 'application/json') {
      return errorResponse('unsupported_media_type', 415);
    }

    const parsedRequest = await readQuery(request);
    if ('error' in parsedRequest) {
      return parsedRequest.error === 'too_large'
        ? errorResponse('payload_too_large', 413)
        : errorResponse('invalid_request', 400);
    }

    const referenceDate = now();
    const startedAt = clockMs();
    const localIntent = parseIntent(parsedRequest.query, undefined, referenceDate);
    const localFallback = interpretationFromLocalIntent(localIntent);
    const emit = (
      source: InterpretationLogEvent['source'],
      fallbackReason: SearchInterpretationFallbackReason | null,
      cache: InterpretationCacheStatus,
      attempts = 0,
      usage: DeepSeekTokenUsage | null = null,
    ) => log({
      event: 'search_interpretation',
      source,
      fallbackReason,
      cache,
      attempts,
      latencyMs: Math.max(0, Math.round(clockMs() - startedAt)),
      usage,
      ...(context?.requestId ? { requestId: context.requestId } : {}),
    });
    const fallback = (
      reason: SearchInterpretationFallbackReason,
      cache: InterpretationCacheStatus = 'bypass',
      attempts = 0,
      usage: DeepSeekTokenUsage | null = null,
    ) => {
      emit('deterministic-fallback', reason, cache, attempts, usage);
      return fallbackResponse(localFallback, reason);
    };

    if (hasSearchPrivacyRisk(parsedRequest.query)) return fallback('privacy_guard');
    if (hasPromptInjectionRisk(parsedRequest.query)) return fallback('blocked');
    if (!shouldUseRemoteInterpretation(parsedRequest.query, localIntent)) {
      return fallback('local_sufficient');
    }

    const providerQuery = sanitizeSearchQueryForRemote(parsedRequest.query);
    if (providerQuery.length < 2) return fallback('privacy_guard');

    const apiKey = getApiKey()?.trim();
    if (!apiKey) return fallback('not_configured');

    try {
      const ttlSeconds = Math.floor(getCacheTtlSeconds());
      const maximumEntries = Math.floor(getCacheMaxEntries());
      const key = await interpretationCacheKey(providerQuery, referenceDate);
      const remote = await loadRemoteInterpretation({
        cache: runtimeCache,
        key,
        ttlSeconds,
        maximumEntries,
        nowMs: clockMs(),
        request: () => requestDeepSeekInterpretation(providerQuery, {
          apiKey,
          fetchImpl,
          referenceDate,
        }),
      });
      const intent = reconcileRemoteIntent(localIntent, remote.intent);
      if (!isInterpretedSearchIntentV1(intent)) {
        return fallback('invalid_output', remote.cacheStatus, remote.attempts, remote.usage);
      }
      emit('deepseek', null, remote.cacheStatus, remote.attempts, remote.usage);
      return jsonResponse({
        version: SEARCH_INTERPRETATION_VERSION,
        source: 'deepseek',
        interpreter: { provider: 'deepseek', model: DEEPSEEK_INTERPRETER_MODEL },
        intent,
      });
    } catch (error) {
      if (error instanceof RuntimeInterpretationFailure) {
        return fallback(error.reason, error.cacheStatus, error.attempts, error.usage);
      }
      const reason = error instanceof SearchInterpreterFailure ? error.reason : 'upstream_unavailable';
      return fallback(
        reason,
        'miss',
        error instanceof SearchInterpreterFailure ? error.attempts : 0,
        error instanceof SearchInterpreterFailure ? error.usage : null,
      );
    }
  };
}

export default createInterpretSearchHandler({ log: productionLog });

export const config: Config = {
  path: API_PATH,
  method: 'POST',
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: ['ip', 'domain'],
    windowSize: 60,
    windowLimit: 12,
  },
};
