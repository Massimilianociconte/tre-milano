import { describe, expect, it, vi } from 'vitest';
import {
  DEEPSEEK_INTERPRETER_ENDPOINT,
  DEEPSEEK_INTERPRETER_MAX_TOKENS,
  DEEPSEEK_INTERPRETER_MODEL,
  DEEPSEEK_INTERPRETER_TIMEOUT_MS,
  buildDeepSeekRequestBody,
  requestDeepSeekInterpretation,
} from './deepseek-interpreter';
import type { RemoteIntentPayloadV1 } from './interpretation-contract';

const validIntent: RemoteIntentPayloadV1 = {
  signals: [{ dimension: 'atmosphere', value: 'intimo', mode: 'prefer' }],
  minSpend: null,
  maxSpend: 50,
  maxMinutes: null,
  requiresOpenNow: false,
  serviceTime: null,
  travelOrigin: 'none',
  unsupportedConstraintCodes: [],
  semanticHints: ['sorprendente'],
};

function providerResponse(payload: unknown, finishReason = 'stop') {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { role: 'assistant', content: JSON.stringify(payload) } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('request DeepSeek', () => {
  it('usa il modello stabile in non-thinking JSON mode con budget chiuso', () => {
    const body = buildDeepSeekRequestBody('un posto che faccia colpo', new Date('2026-07-16T12:00:00+02:00'));
    expect(body).toMatchObject({
      model: DEEPSEEK_INTERPRETER_MODEL,
      thinking: { type: 'disabled' },
      stream: false,
      response_format: { type: 'json_object' },
      max_tokens: DEEPSEEK_INTERPRETER_MAX_TOKENS,
      temperature: 0,
    });
    expect(DEEPSEEK_INTERPRETER_TIMEOUT_MS).toBe(2_400);
    expect(JSON.stringify(body)).not.toContain('user_id');
    expect(body.messages[0].content.toLocaleLowerCase('it-IT')).toContain('json');
    expect(body.messages[0].content).not.toContain('Notturno');
  });

  it('manda la chiave soltanto nel Bearer header e valida il payload', async () => {
    let capturedUrl: string | URL | Request | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = input;
      capturedInit = init;
      return providerResponse(validIntent);
    });
    await expect(requestDeepSeekInterpretation('posto sorprendente', {
      apiKey: 'server-secret',
      fetchImpl,
      referenceDate: new Date('2026-07-16T12:00:00+02:00'),
    })).resolves.toEqual(validIntent);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(capturedUrl).toBe(DEEPSEEK_INTERPRETER_ENDPOINT);
    expect(capturedInit?.headers).toMatchObject({ Authorization: 'Bearer server-secret' });
    expect(capturedInit?.body).not.toContain('server-secret');
  });

  it.each([
    [{}, 'invalid_output'],
    [{ ...validIntent, venueId: 'notturno' }, 'invalid_output'],
    [{ ...validIntent, semanticHints: ['Lume Brera'] }, 'invalid_output'],
  ])('rifiuta output non conforme senza recupero permissivo', async (payload, reason) => {
    const fetchImpl = vi.fn(async () => providerResponse(payload));
    await expect(requestDeepSeekInterpretation('query complessa', { apiKey: 'secret', fetchImpl }))
      .rejects.toMatchObject({ reason });
  });

  it('classifica content filter e risorse insufficienti senza esporre il body', async () => {
    const filtered = vi.fn(async () => providerResponse(validIntent, 'content_filter'));
    await expect(requestDeepSeekInterpretation('query', { apiKey: 'secret', fetchImpl: filtered }))
      .rejects.toMatchObject({ reason: 'blocked' });
    const unavailable = vi.fn(async () => providerResponse(validIntent, 'insufficient_system_resource'));
    await expect(requestDeepSeekInterpretation('query', { apiKey: 'secret', fetchImpl: unavailable }))
      .rejects.toMatchObject({ reason: 'upstream_unavailable' });
  });

  it('interrompe il provider al timeout', async () => {
    const fetchImpl = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(requestDeepSeekInterpretation('query complessa', {
      apiKey: 'secret',
      fetchImpl,
      timeoutMs: 5,
    })).rejects.toEqual(expect.objectContaining({ reason: 'timeout' }));
  });
});
