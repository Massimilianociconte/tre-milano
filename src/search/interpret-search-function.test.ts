import { describe, expect, it, vi } from 'vitest';
import { parseIntent } from '../ranking/rank';
import {
  SEARCH_INTERPRETATION_VERSION,
  interpretationFromLocalIntent,
  isSearchInterpretationResponseV1,
} from './interpretation-contract';
import { createInterpretSearchHandler } from '../../netlify/functions/interpret-search';

const endpoint = 'https://tre-milano.test/api/search/interpret';

function request(body: unknown, init: { origin?: string; contentType?: string; method?: string } = {}) {
  return new Request(endpoint, {
    method: init.method ?? 'POST',
    headers: {
      Origin: init.origin ?? 'https://tre-milano.test',
      'Content-Type': init.contentType ?? 'application/json',
    },
    body: (init.method ?? 'POST') === 'GET' ? undefined : JSON.stringify(body),
  });
}

const queryRequest = (query: string) => ({ version: SEARCH_INTERPRETATION_VERSION, query });

const remotePayload = {
  signals: [{ dimension: 'atmosphere', value: 'intimo', mode: 'prefer' }],
  minSpend: null,
  maxSpend: null,
  maxMinutes: null,
  requiresOpenNow: false,
  serviceTime: null,
  travelOrigin: 'none',
  unsupportedConstraintCodes: [],
  semanticHints: ['cinematografico'],
};

function providerResponse(payload: unknown = remotePayload) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(payload) } }],
  }), { status: 200 });
}

describe('POST /api/search/interpret', () => {
  it('rifiuta metodo, origine e media type non ammessi prima del provider', async () => {
    const fetchImpl = vi.fn();
    const handler = createInterpretSearchHandler({ fetchImpl, getApiKey: () => 'secret' });
    const methodResponse = await handler(request({}, { method: 'GET' }));
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.headers.get('allow')).toBe('POST');
    expect((await handler(request(queryRequest('posto intimo'), { origin: 'https://evil.test' }))).status).toBe(403);
    expect((await handler(request(queryRequest('posto intimo'), { contentType: 'text/plain' }))).status).toBe(415);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rifiuta body extra, query oltre limite e body sovradimensionato', async () => {
    const handler = createInterpretSearchHandler({ getApiKey: () => 'secret' });
    expect((await handler(request({ query: 'posto intimo' }))).status).toBe(400);
    expect((await handler(request({ version: 'tre-search-interpretation-v0', query: 'posto intimo' }))).status).toBe(400);
    expect((await handler(request({ ...queryRequest('posto intimo'), userId: '123' }))).status).toBe(400);
    expect((await handler(request(queryRequest('a'.repeat(321))))).status).toBe(400);
    expect((await handler(request(queryRequest('a'.repeat(2_100))))).status).toBe(413);
  });

  it('non spende una chiamata per query semplici o vincoli non supportati', async () => {
    const fetchImpl = vi.fn();
    const handler = createInterpretSearchHandler({ fetchImpl, getApiKey: () => 'secret' });
    const simple = await (await handler(request(queryRequest('aperitivo elegante a Brera')))).json();
    expect(simple).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'local_sufficient' });
    const unsupported = await (await handler(request(queryRequest('cena vegana obbligatoria')))).json();
    expect(unsupported).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'local_sufficient' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('non chiama DeepSeek quando scatta il privacy guard', async () => {
    const fetchImpl = vi.fn();
    const query = 'scrivimi a mario@example.it per un aperitivo';
    const response = await createInterpretSearchHandler({ fetchImpl, getApiKey: () => 'secret' })(request(queryRequest(query)));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'privacy_guard' });
    expect(JSON.stringify(body)).not.toContain(query);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'mario rossi',
    'diabete tipo due',
    'piazzale loreto 5',
    'un posto intimo come casa di Mario Rossi in via Torino 10',
    'un posto tranquillo per parlare della sieropositività di mia figlia',
  ])('mantiene locale anche una forma personale non strutturata: %s', async (query) => {
    const fetchImpl = vi.fn();
    const response = await createInterpretSearchHandler({ fetchImpl, getApiKey: () => 'secret' })(request(queryRequest(query)));
    const body = await response.json();
    expect(body).toMatchObject({
      source: 'deterministic-fallback',
      fallbackReason: 'privacy_guard',
    });
    expect(body.intent).toEqual(interpretationFromLocalIntent(parseIntent(query)));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('resta operativo senza chiave server', async () => {
    const response = await createInterpretSearchHandler({ getApiKey: () => undefined })(request(queryRequest(
      'un posto che sembri uscito da un film',
    )));
    const body = await response.json();
    expect(body).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'not_configured' });
    expect(isSearchInterpretationResponseV1(body)).toBe(true);
  });

  it('restituisce soltanto intento riconciliato e metadata allowlist', async () => {
    const fetchImpl = vi.fn(async () => providerResponse());
    const query = 'un posto che sembri uscito da un film';
    const response = await createInterpretSearchHandler({
      fetchImpl,
      getApiKey: () => 'server-secret',
      now: () => new Date('2026-07-16T12:00:00+02:00'),
    })(request(queryRequest(query)));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      source: 'deepseek',
      interpreter: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      intent: { atmosphere: ['intimo'] },
    });
    expect(isSearchInterpretationResponseV1(body)).toBe(true);
    expect(JSON.stringify(body)).not.toContain(query);
    expect(JSON.stringify(body)).not.toContain('server-secret');
  });

  it('converte errori upstream e JSON non conforme in fallback locale', async () => {
    const unavailable = vi.fn(async () => new Response('', { status: 503 }));
    const unavailableBody = await (await createInterpretSearchHandler({
      fetchImpl: unavailable,
      getApiKey: () => 'secret',
    })(request(queryRequest('posto molto particolare')))).json();
    expect(unavailableBody).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'upstream_unavailable' });

    const invalid = vi.fn(async () => providerResponse({ ...remotePayload, rank: 1 }));
    const invalidBody = await (await createInterpretSearchHandler({
      fetchImpl: invalid,
      getApiKey: () => 'secret',
    })(request(queryRequest('posto molto particolare')))).json();
    expect(invalidBody).toMatchObject({ source: 'deterministic-fallback', fallbackReason: 'invalid_output' });
  });
});
