import { describe, expect, it } from 'vitest';
import { serializeJsonLd } from './serialize-json-ld';

describe('serializzazione JSON-LD sicura', () => {
  it('neutralizza una chiusura script senza alterare il dato JSON', () => {
    const payload = { name: '</script><script>alert(1)</script>' };
    const serialized = serializeJsonLd(payload);
    expect(serialized).not.toContain('<');
    expect(JSON.parse(serialized)).toEqual(payload);
  });

  it('escapa i separatori di riga JavaScript preservando il contenuto', () => {
    const payload = { text: `prima\u2028seconda\u2029terza` };
    const serialized = serializeJsonLd(payload);
    expect(serialized).not.toContain('\u2028');
    expect(serialized).not.toContain('\u2029');
    expect(JSON.parse(serialized)).toEqual(payload);
  });
});
