import type { Config, Context } from '@netlify/functions';
import { parseIntent } from '../../src/ranking/rank';
import {
  SEARCH_INTERPRETATION_VERSION,
  hasSearchPrivacyRisk,
  interpretationFromLocalIntent,
  isInterpretedSearchIntentV1,
  reconcileRemoteIntent,
  shouldUseRemoteInterpretation,
  validateSearchQuery,
  type SearchInterpretationErrorV1,
  type SearchInterpretationFallbackReason,
  type SearchInterpretationResponseV1,
} from '../../src/search/interpretation-contract';
import {
  DEEPSEEK_INTERPRETER_MODEL,
  SearchInterpreterFailure,
  requestDeepSeekInterpretation,
} from '../../src/search/deepseek-interpreter';
import { serverEnv } from './_shared/env';

const REQUEST_MAX_BYTES = 2_048;
const API_PATH = '/api/search/interpret';

type HandlerDependencies = {
  fetchImpl?: typeof fetch;
  getApiKey?: () => string | undefined;
  now?: () => Date;
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

export function createInterpretSearchHandler({
  fetchImpl = fetch,
  getApiKey = () => serverEnv('DEEPSEEK_API_KEY'),
  now = () => new Date(),
}: HandlerDependencies = {}) {
  return async (request: Request, _context?: Context) => {
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
    const localIntent = parseIntent(parsedRequest.query, undefined, referenceDate);
    const localFallback = interpretationFromLocalIntent(localIntent);
    if (hasSearchPrivacyRisk(parsedRequest.query)) return fallbackResponse(localFallback, 'privacy_guard');
    if (!shouldUseRemoteInterpretation(parsedRequest.query, localIntent)) {
      return fallbackResponse(localFallback, 'local_sufficient');
    }

    const apiKey = getApiKey()?.trim();
    if (!apiKey) return fallbackResponse(localFallback, 'not_configured');

    try {
      const remote = await requestDeepSeekInterpretation(parsedRequest.query, {
        apiKey,
        fetchImpl,
        referenceDate,
      });
      const intent = reconcileRemoteIntent(localIntent, remote);
      if (!isInterpretedSearchIntentV1(intent)) return fallbackResponse(localFallback, 'invalid_output');
      return jsonResponse({
        version: SEARCH_INTERPRETATION_VERSION,
        source: 'deepseek',
        interpreter: { provider: 'deepseek', model: DEEPSEEK_INTERPRETER_MODEL },
        intent,
      });
    } catch (error) {
      const reason = error instanceof SearchInterpreterFailure ? error.reason : 'upstream_unavailable';
      return fallbackResponse(localFallback, reason);
    }
  };
}

export default createInterpretSearchHandler();

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
