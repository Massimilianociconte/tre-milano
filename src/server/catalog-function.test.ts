import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCatalogHandler } from '../../netlify/functions/catalog';
import { decodeCatalogCursor } from './catalog-query';

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

  it('rejects an invalid open-now flag before touching the backend', async () => {
    const response = await createCatalogHandler()(
      new Request('https://tre.test/api/catalog?open_now=true', { headers: { Origin: 'https://tre.test' } }), context,
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
    'open_now=1',
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

  it('proietta stato di verifica e apertura, filtrando open-now nel database', async () => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    };
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    let searchPayload: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (url.endsWith('/search_venues')) {
        searchPayload = JSON.parse(String(init?.body));
        return new Response(JSON.stringify([{
        id: 'f3da8434-e4fe-4ce9-8a6f-323f90a43ac5',
        slug: 'locale-reale',
        name: 'Locale Reale',
        short_description: null,
        category_slug: 'ristorante',
        category_name: 'Ristorante',
        subcategory_slug: null,
        neighborhood_slug: 'brera',
        neighborhood_name: 'Brera',
        municipality_id: 1,
        latitude: 45.47,
        longitude: 9.19,
        formatted_address: 'Via Brera 1, Milano',
        price_level: null,
        average_spend_cents: null,
        rating: null,
        review_count: null,
        review_source_count: null,
        rating_sources: [],
        image_url: null,
        image_alt: null,
        service_slugs: [],
        weekly_hours: [
          {
            weekday: 5, sequence: 1, opensAt: '18:00', closesAt: '23:00',
            closesNextDay: false, closed: false, verifiedAt: '2026-07-16T08:00:00Z', validUntil: null,
          },
          { weekday: 9, sequence: 1, opensAt: '18:00', closesAt: '23:00' },
        ],
        hours_source_url: 'https://www.locale-reale.it/orari',
        verification_status: 'verified',
        open_now: true,
        maturity: 'gold',
        quality_score: 90,
        confidence_score: 0.9,
        verified_at: '2026-07-16T08:00:00Z',
        published_at: '2026-07-16T08:00:00Z',
        distance_meters: null,
        relevance_score: 0,
        sort_value: 90,
        sort_text: null,
        }]));
      }
      if (url.endsWith('/get_venue_recommendation_eligibility')) {
        return new Response(JSON.stringify([{
          id: 'f3da8434-e4fe-4ce9-8a6f-323f90a43ac5',
          recommendation_eligible: true,
        }]));
      }
      return new Response('{}', { status: 404 });
    }));

    const response = await createCatalogHandler()(
      new Request('https://tre.test/api/catalog?sort=quality&subcategory=speakeasy&open_now=1', { headers: { Origin: 'https://tre.test' } }), context,
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.data[0]).toMatchObject({
      weeklyHours: [{
        weekday: 5,
        opensAt: '18:00',
        closesAt: '23:00',
        verifiedAt: '2026-07-16T08:00:00.000Z',
      }],
      hoursSourceUrl: 'https://www.locale-reale.it/orari',
      verification: { status: 'verified' },
      recommendationEligible: true,
      openNow: true,
    });
    expect(searchPayload).toMatchObject({ p_subcategory_slugs: ['speakeasy'], p_open_now: true });
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.has('etag')).toBe(false);
  });

  it('applica il gate autorevole e fa avanzare il cursore oltre le righe scartate', async () => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    };
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ];
    const rows = ids.map((id, index) => ({
      id,
      slug: `locale-${index + 1}`,
      name: `Locale ${index + 1}`,
      short_description: null,
      category_slug: 'ristorante',
      category_name: 'Ristorante',
      subcategory_slug: null,
      neighborhood_slug: 'brera',
      neighborhood_name: 'Brera',
      municipality_id: 1,
      latitude: 45.47,
      longitude: 9.19,
      formatted_address: `Via Brera ${index + 1}, Milano`,
      price_level: null,
      average_spend_cents: null,
      rating: null,
      review_count: null,
      review_source_count: null,
      rating_sources: [],
      image_url: null,
      image_alt: null,
      service_slugs: [],
      weekly_hours: [],
      hours_source_url: null,
      verification_status: 'verified',
      open_now: false,
      maturity: 'gold',
      quality_score: 100 - index * 10,
      confidence_score: 0.9,
      verified_at: '2026-07-17T08:00:00Z',
      published_at: '2026-07-17T08:00:00Z',
      distance_meters: null,
      relevance_score: 0,
      sort_value: 100 - index * 10,
      sort_text: null,
    }));
    let eligibilityPayload: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/consume_api_rate_limit')) {
        return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      }
      if (url.endsWith('/search_venues')) return new Response(JSON.stringify(rows));
      if (url.endsWith('/get_venue_recommendation_eligibility')) {
        eligibilityPayload = JSON.parse(String(init?.body));
        return new Response(JSON.stringify([
          { id: ids[0], recommendation_eligible: false },
          { id: ids[1], recommendation_eligible: true },
          { id: ids[2], recommendation_eligible: false },
        ]));
      }
      return new Response('{}', { status: 404 });
    }));

    const handler = createCatalogHandler();
    const verifiedResponse = await handler(
      new Request('https://tre.test/api/catalog?limit=2&sort=quality', { headers: { Origin: 'https://tre.test' } }), context,
    );
    const verifiedPayload = await verifiedResponse.json();
    expect(verifiedResponse.status).toBe(200);
    expect(verifiedPayload.data).toHaveLength(1);
    expect(verifiedPayload.data[0]).toMatchObject({
      id: ids[1],
      recommendationEligible: true,
    });
    expect(verifiedPayload.pagination.hasMore).toBe(true);
    expect(decodeCatalogCursor(verifiedPayload.pagination.nextCursor)).toMatchObject({ id: ids[2] });
    expect(eligibilityPayload).toEqual({ p_venue_ids: ids });

    const exploreResponse = await handler(
      new Request('https://tre.test/api/catalog?limit=2&sort=quality&include_unverified=1', { headers: { Origin: 'https://tre.test' } }), context,
    );
    const explorePayload = await exploreResponse.json();
    expect(exploreResponse.status).toBe(200);
    expect(explorePayload.data).toMatchObject([
      { id: ids[0], recommendationEligible: false },
      { id: ids[1], recommendationEligible: true },
    ]);
    expect(decodeCatalogCursor(explorePayload.pagination.nextCursor)).toMatchObject({ id: ids[1] });
  });

  it('omette i nuovi argomenti opzionali durante un rolling deploy legacy', async () => {
    const values: Record<string, string> = {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SECRET_KEY: `sb_secret_${'x'.repeat(40)}`,
      RATE_LIMIT_HASH_SECRET: 'r'.repeat(40),
    };
    let searchPayload: Record<string, unknown> | null = null;
    vi.stubGlobal('Netlify', { env: { get: (name: string) => values[name] } });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/consume_api_rate_limit')) return new Response('[{"allowed":true,"request_count":1,"retry_after_seconds":60}]');
      if (String(input).endsWith('/search_venues')) {
        searchPayload = JSON.parse(String(init?.body));
        return new Response('[]');
      }
      return new Response('{}', { status: 404 });
    }));

    const response = await createCatalogHandler()(
      new Request('https://tre.test/api/catalog?sort=quality', { headers: { Origin: 'https://tre.test' } }), context,
    );
    expect(response.status).toBe(200);
    expect(searchPayload).not.toHaveProperty('p_subcategory_slugs');
    expect(searchPayload).not.toHaveProperty('p_after_text');
    expect(searchPayload).not.toHaveProperty('p_open_now');
  });
});
