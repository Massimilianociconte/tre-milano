import { afterEach, describe, expect, it, vi } from 'vitest';
import catalogFacets from '../../netlify/functions/catalog-facets';

const context = { requestId: 'facets-test', ip: '127.0.0.1', params: {} } as never;

describe('catalog facets cache privacy', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not cache a viewport-specific facet response', async () => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    };
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (String(input).endsWith('/catalog_facets')) return new Response('{"total":0}');
      return new Response('{}', { status: 404 });
    }));
    const response = await catalogFacets(
      new Request('https://tre.test/api/catalog/facets?bbox=9.1,45.4,9.2,45.5', { headers: { Origin: 'https://tre.test' } }), context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('vary')).toBe('Origin, Accept-Encoding');
  });

  it('assigns a durable ETag only to the public facet representation', async () => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40), CATALOG_API_CACHE_SECONDS: '60',
    };
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (String(input).endsWith('/catalog_facets')) return new Response('{"total":6}');
      return new Response('{}', { status: 404 });
    }));
    const url = 'https://tre.test/api/catalog/facets';
    const first = await catalogFacets(new Request(url, { headers: { Origin: 'https://tre.test' } }), context);
    const etag = first.headers.get('etag');
    expect(first.status).toBe(200);
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(first.headers.get('netlify-cdn-cache-control')).toContain('durable');

    const revalidated = await catalogFacets(new Request(url, {
      headers: { Origin: 'https://tre.test', 'If-None-Match': etag as string },
    }), context);
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('etag')).toBe(etag);
    expect(revalidated.headers.get('cache-control')).toContain('s-maxage=60');
    expect(revalidated.headers.get('vary')).toBe('Origin, Accept-Encoding');
  });

  it('marks a cross-origin denial as origin-varying and non-cacheable', async () => {
    const response = await catalogFacets(
      new Request('https://tre.test/api/catalog/facets', { headers: { Origin: 'https://evil.test' } }), context,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('allinea esplicitamente le facet alla vetrina Explore estesa', async () => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    };
    let rpcPayload: Record<string, unknown> | null = null;
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (String(input).endsWith('/catalog_facets')) {
        rpcPayload = JSON.parse(String(init?.body));
        return new Response('{"total":1670,"categories":[],"neighborhoods":[],"priceLevels":[],"services":[]}');
      }
      return new Response('{}', { status: 404 });
    }));

    const response = await catalogFacets(
      new Request('https://tre.test/api/catalog/facets', { headers: { Origin: 'https://tre.test' } }), context,
    );
    expect(response.status).toBe(200);
    expect(rpcPayload).toMatchObject({ p_include_unverified: true });
  });

  it('resta disponibile durante il rolling deploy soltanto per la vecchia firma RPC', async () => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    };
    const rpcPayloads: Record<string, unknown>[] = [];
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (String(input).endsWith('/catalog_facets')) {
        const payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        rpcPayloads.push(payload);
        if ('p_include_unverified' in payload) {
          return new Response('{"code":"PGRST202"}', { status: 404 });
        }
        return new Response('{"total":6,"categories":[],"neighborhoods":[],"priceLevels":[]}');
      }
      return new Response('{}', { status: 404 });
    }));

    const response = await catalogFacets(
      new Request('https://tre.test/api/catalog/facets', { headers: { Origin: 'https://tre.test' } }), context,
    );
    expect(response.status).toBe(200);
    expect(rpcPayloads).toHaveLength(2);
    expect(rpcPayloads[0]).toMatchObject({ p_include_unverified: true });
    expect(rpcPayloads[1]).not.toHaveProperty('p_include_unverified');
  });
});
