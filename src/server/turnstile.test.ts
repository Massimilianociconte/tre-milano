import { describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '../../netlify/functions/venue-claims';

describe('Turnstile claim binding', () => {
  const expected = { hostname: 'www.tremilano.it', action: 'venue_claim' };

  it('accepts only success bound to the configured hostname and action', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ success: true, ...expected }))) as unknown as typeof fetch;
    await expect(verifyTurnstile('token', '203.0.113.1', 'secret', expected, fetchImpl)).resolves.toBe(true);
  });

  it.each([
    { success: true, hostname: 'evil.test', action: 'venue_claim' },
    { success: true, hostname: 'www.tremilano.it', action: 'other' },
    { success: false, hostname: 'www.tremilano.it', action: 'venue_claim' },
  ])('rejects mismatched proof %#', async (result) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(result))) as unknown as typeof fetch;
    await expect(verifyTurnstile('token', '203.0.113.1', 'secret', expected, fetchImpl)).resolves.toBe(false);
  });
});
