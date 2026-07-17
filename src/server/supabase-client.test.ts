import { describe, expect, it, vi } from 'vitest';
import { createSupabaseAdminClient, SupabaseRequestError } from '../../netlify/functions/_shared/supabase';

const legacyConfig = { url: 'https://project.supabase.co', apiKey: 'legacy-service-role-key-that-is-long-enough' };
const secretConfig = { url: 'https://project.supabase.co', apiKey: `sb_secret_${'x'.repeat(40)}` };

describe('Supabase server client', () => {
  it('sends the service key only in server-side authorization headers', async () => {
    let capturedUrl = '';
    let capturedInit: RequestInit | undefined;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedInit = init;
      return new Response('[{"id":"1"}]', { status: 200 });
    }) as typeof fetch;
    const client = createSupabaseAdminClient({ config: legacyConfig, fetchImpl });
    await expect(client.rpc('search_venues', { p_limit: 1 })).resolves.toEqual([{ id: '1' }]);
    expect(capturedUrl).toBe('https://project.supabase.co/rest/v1/rpc/search_venues');
    const headers = new Headers(capturedInit?.headers);
    expect(headers.get('apikey')).toBe(legacyConfig.apiKey);
    expect(headers.get('authorization')).toBe(`Bearer ${legacyConfig.apiKey}`);
  });

  it('sends modern sb_secret keys only in apikey and never as a JWT', async () => {
    let capturedHeaders: HeadersInit | undefined;
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response('[]', { status: 200 });
    }) as typeof fetch;
    await createSupabaseAdminClient({ config: secretConfig, fetchImpl }).rpc('search_venues', {});
    const headers = new Headers(capturedHeaders);
    expect(headers.get('apikey')).toBe(secretConfig.apiKey);
    expect(headers.has('authorization')).toBe(false);
  });

  it('sanitizes upstream database errors', async () => {
    const client = createSupabaseAdminClient({
      config: secretConfig,
      fetchImpl: vi.fn(async () => new Response('{"code":"42501","message":"sensitive database detail"}', { status: 403 })),
    });
    await expect(client.rpc('search_venues', {})).rejects.toMatchObject({ status: 403, code: '42501', message: 'Database request failed' } satisfies Partial<SupabaseRequestError>);
  });

  it('rejects an unexpected RPC name before a network request', () => {
    const client = createSupabaseAdminClient({ config: secretConfig, fetchImpl: vi.fn() });
    expect(() => client.rpc('search-venues;drop', {})).toThrow('Invalid RPC name');
  });
});
