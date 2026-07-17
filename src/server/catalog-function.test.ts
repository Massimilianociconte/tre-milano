import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCatalogHandler } from '../../netlify/functions/catalog';

const context = { requestId: 'req-test', ip: '127.0.0.1', params: {} } as never;

describe('catalog Netlify Function', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fails closed without server database configuration', async () => {
    const response = await createCatalogHandler()(
      new Request('https://tre.test/api/catalog?limit=3', { headers: { Origin: 'https://tre.test' } }), context,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ title: 'Catalogo non configurato', requestId: 'req-test' });
  });

  it('rejects invalid inputs before touching the backend', async () => {
    const response = await createCatalogHandler()(
      new Request('https://tre.test/api/catalog?limit=999', { headers: { Origin: 'https://tre.test' } }), context,
    );
    expect(response.status).toBe(400);
  });

  it('rejects cross-origin browser access', async () => {
    const response = await createCatalogHandler()(
      new Request('https://tre.test/api/catalog', { headers: { Origin: 'https://evil.test' } }), context,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it.each([
    'q=romantico',
    'lat=45.46&lng=9.19&radius_m=1000',
    'bbox=9.1,45.4,9.2,45.5',
  ])('never stores query or geo requests in browser/CDN cache: %s', async (query) => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    };
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (url.endsWith('/search_venues')) return new Response('[]');
      return new Response('{}', { status: 404 });
    }));
    const response = await createCatalogHandler()(
      new Request(`https://tre.test/api/catalog?${query}`, { headers: { Origin: 'https://tre.test' } }), context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.has('netlify-cdn-cache-control')).toBe(false);
    expect(response.headers.has('etag')).toBe(false);
  });

  it('keeps a public representation and its ETag stable within the CDN cache window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T10:00:05.000Z'));
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
      CATALOG_API_CACHE_SECONDS: '60',
    };
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (url.endsWith('/search_venues')) return new Response('[]');
      return new Response('{}', { status: 404 });
    }));

    const handler = createCatalogHandler();
    const first = await handler(
      new Request('https://tre.test/api/catalog?limit=3', { headers: { Origin: 'https://tre.test' } }), context,
    );
    const firstEtag = first.headers.get('etag');
    const firstBody = await first.json();
    expect(first.status).toBe(200);
    expect(firstEtag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(firstBody.meta.generatedAt).toBe('2026-07-17T10:00:00.000Z');

    vi.setSystemTime(new Date('2026-07-17T10:00:45.000Z'));
    const revalidated = await handler(
      new Request('https://tre.test/api/catalog?limit=3', {
        headers: { Origin: 'https://tre.test', 'If-None-Match': firstEtag as string },
      }),
      context,
    );
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('etag')).toBe(firstEtag);
    expect(revalidated.headers.get('cache-control')).toContain('s-maxage=60');
    expect(revalidated.headers.get('netlify-cdn-cache-control')).toContain('durable');
    expect(revalidated.headers.get('vary')).toBe('Origin, Accept-Encoding');

    vi.setSystemTime(new Date('2026-07-17T10:01:05.000Z'));
    const nextWindow = await handler(
      new Request('https://tre.test/api/catalog?limit=3', {
        headers: { Origin: 'https://tre.test', 'If-None-Match': firstEtag as string },
      }),
      context,
    );
    const nextBody = await nextWindow.json();
    expect(nextWindow.status).toBe(200);
    expect(nextWindow.headers.get('etag')).not.toBe(firstEtag);
    expect(nextBody.meta.generatedAt).toBe('2026-07-17T10:01:00.000Z');
  });
});
