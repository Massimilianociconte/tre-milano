import { describe, expect, it } from 'vitest';
import { cacheWindowTimestamp, problem } from '../../netlify/functions/_shared/http';

describe('Netlify HTTP response contract', () => {
  it('uses a stable internal URN for default Problem Details types', async () => {
    const response = problem(503, 'Catalogo non configurato', { requestId: 'req-test' });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      type: 'urn:tre-milano:problem:http-status:503',
      title: 'Catalogo non configurato',
      status: 503,
      requestId: 'req-test',
    });
  });

  it('preserves an explicitly supplied Problem Details type', async () => {
    const response = problem(400, 'Richiesta non valida', { type: 'urn:tre-milano:problem:catalog-query' });
    expect(await response.json()).toMatchObject({ type: 'urn:tre-milano:problem:catalog-query' });
  });

  it('derives a deterministic timestamp from the active cache window', () => {
    const withinWindow = Date.parse('2026-07-17T10:00:45.000Z');
    const nextWindow = Date.parse('2026-07-17T10:01:05.000Z');

    expect(cacheWindowTimestamp(60, withinWindow)).toBe('2026-07-17T10:00:00.000Z');
    expect(cacheWindowTimestamp(60, nextWindow)).toBe('2026-07-17T10:01:00.000Z');
    expect(cacheWindowTimestamp(0, withinWindow)).toBe('2026-07-17T10:00:45.000Z');
  });
});
