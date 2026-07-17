import { afterEach, describe, expect, it, vi } from 'vitest';
import venueDetail from '../../netlify/functions/venue-detail';

const context = {
  requestId: 'venue-detail-test',
  ip: '127.0.0.1',
  params: { slug: 'camparino-in-galleria' },
} as never;

function configureRuntime() {
  const values: Record<string, string> = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
    RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    CATALOG_API_CACHE_SECONDS: '60',
  };
  vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/consume_api_rate_limit')) {
      return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
    }
    if (String(input).endsWith('/get_venue_detail')) {
      return new Response('{"slug":"camparino-in-galleria"}');
    }
    return new Response('{}', { status: 404 });
  }));
}

describe('venue detail Function cache boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('varies cache entries by Origin and preserves that boundary on 304', async () => {
    configureRuntime();
    const request = new Request('https://tre.test/api/venues/camparino-in-galleria', {
      headers: { Origin: 'https://tre.test' },
    });
    const first = await venueDetail(request, context);
    const etag = first.headers.get('etag');
    expect(first.status).toBe(200);
    expect(first.headers.get('vary')).toBe('Origin, Accept-Encoding');
    expect(etag).toMatch(/^"[a-f0-9]{64}"$/);

    const revalidated = await venueDetail(new Request(request.url, {
      headers: { Origin: 'https://tre.test', 'If-None-Match': etag as string },
    }), context);
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get('vary')).toBe('Origin, Accept-Encoding');
    expect(revalidated.headers.get('cache-control')).toContain('s-maxage=60');
    expect(revalidated.headers.get('netlify-cdn-cache-control')).toContain('durable');
  });

  it('rejects a cross-origin browser request before the backend', async () => {
    const response = await venueDetail(new Request(
      'https://tre.test/api/venues/camparino-in-galleria',
      { headers: { Origin: 'https://evil.test' } },
    ), context);
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('vary')).toBe('Origin');
  });
});
