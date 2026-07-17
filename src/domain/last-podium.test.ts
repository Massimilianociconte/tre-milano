import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import { applyRankingOverrides, parseIntent, rankVenues } from '../ranking/rank';
import {
  LAST_PODIUM_STORAGE_KEY,
  LAST_PODIUM_TTL_MS,
  clearLastPodium,
  createLastPodiumSnapshot,
  lastPodiumIntentToOverrides,
  parseLastPodiumSnapshot,
  readLastPodium,
  writeLastPodium,
  type LastPodiumStorage,
} from './last-podium';

function memoryStorage(initial?: string): LastPodiumStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(LAST_PODIUM_STORAGE_KEY, initial);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
}

const referenceNow = Date.parse('2026-07-16T20:00:00+02:00');
const referenceDate = new Date(referenceNow);

describe('ultimo podio offline privacy-first v1', () => {
  it('serializza soltanto venue IDs e intento tassonomizzato con expiry breve', () => {
    const query = 'cocktail bar elegante sotto 40 euro codice riservato delta';
    const intent = parseIntent(query, undefined, referenceDate);
    const results = rankVenues(query, undefined, venues, {}, undefined, referenceDate);
    const snapshot = createLastPodiumSnapshot(results.map(({ id }) => id), intent, referenceNow);
    const serialized = JSON.stringify(snapshot);

    expect(snapshot.version).toBe(1);
    expect(snapshot.venueIds.length).toBeGreaterThan(0);
    expect(snapshot.venueIds.length).toBeLessThanOrEqual(3);
    expect(snapshot.expiresAt - snapshot.createdAt).toBe(LAST_PODIUM_TTL_MS);
    expect(serialized).not.toContain('codice riservato');
    expect(serialized).not.toContain('delta');
    expect(serialized).not.toMatch(/"(?:query|semanticTokens|profile|coordinates|latitude|longitude|label)"/);
    expect(snapshot.intent).toMatchObject({ categories: ['Cocktail bar'], maxSpend: 40 });
    expect(snapshot.intent.atmosphere).toContain('elegante');
  });

  it('rifiuta campi extra, testo libero, tassonomie sconosciute e più di tre IDs', () => {
    const intent = parseIntent('aperitivo elegante', undefined, referenceDate);
    const baseline = createLastPodiumSnapshot(['lume-brera'], intent, referenceNow);

    expect(parseLastPodiumSnapshot({ ...baseline, query: 'testo libero' }, referenceNow)).toBeNull();
    expect(parseLastPodiumSnapshot({ ...baseline, coordinates: { latitude: 45.4, longitude: 9.2 } }, referenceNow)).toBeNull();
    expect(parseLastPodiumSnapshot({ ...baseline, profile: { mood: 'intimo' } }, referenceNow)).toBeNull();
    expect(parseLastPodiumSnapshot({
      ...baseline,
      intent: { ...baseline.intent, atmosphere: ['valore inventato'] },
    }, referenceNow)).toBeNull();
    expect(parseLastPodiumSnapshot({
      ...baseline,
      venueIds: ['lume-brera', 'quota-ventuno', 'sala-nove', 'ombra-moscova'],
    }, referenceNow)).toBeNull();
  });

  it('rimuove automaticamente snapshot scaduti o corrotti', () => {
    const intent = parseIntent('aperitivo elegante', undefined, referenceDate);
    const expired = createLastPodiumSnapshot(['lume-brera'], intent, referenceNow);
    const expiredStorage = memoryStorage(JSON.stringify(expired));
    const corruptStorage = memoryStorage('{non-json');

    expect(readLastPodium(expiredStorage, expired.expiresAt + 1)).toBeNull();
    expect(expiredStorage.values.has(LAST_PODIUM_STORAGE_KEY)).toBe(false);
    expect(readLastPodium(corruptStorage, referenceNow)).toBeNull();
    expect(corruptStorage.values.has(LAST_PODIUM_STORAGE_KEY)).toBe(false);
  });

  it('round-trip e cancellazione non aggiungono dati oltre lo schema', () => {
    const intent = parseIntent('rooftop al Duomo entro 15 minuti', undefined, referenceDate);
    const results = rankVenues(intent.query, undefined, venues, {}, undefined, referenceDate);
    const storage = memoryStorage();
    const written = writeLastPodium(storage, results.map(({ id }) => id), intent, referenceNow);
    const restored = readLastPodium(storage, referenceNow + 1);

    expect(restored).toEqual(written);
    clearLastPodium(storage);
    expect(storage.values.has(LAST_PODIUM_STORAGE_KEY)).toBe(false);
  });

  it('ricostruisce il podio passando nuovamente da vincoli hard e gate Gold', () => {
    const query = 'aperitivo elegante frase segreta omega';
    const intent = parseIntent(query, undefined, referenceDate);
    const original = rankVenues(query, undefined, venues, {}, undefined, referenceDate);
    const snapshot = createLastPodiumSnapshot(original.map(({ id }) => id), intent, referenceNow);
    const overrides = lastPodiumIntentToOverrides(snapshot.intent);
    const effectiveIntent = applyRankingOverrides(parseIntent('', undefined, referenceDate), overrides);
    const source = snapshot.venueIds.map((id) => venues.find((venue) => venue.id === id)!);
    const restored = rankVenues('', undefined, source, overrides, undefined, referenceDate);

    expect(new Set(restored.map(({ id }) => id))).toEqual(new Set(snapshot.venueIds));
    expect(restored.every(({ recommendationEligible, maturityTier, averageSpend }) => (
      recommendationEligible
      && ['Gold', 'Platinum'].includes(maturityTier)
      && averageSpend > 0
    ))).toBe(true);
    expect(effectiveIntent.query).toBe('');

    const silverOnly = venues.find(({ maturityTier }) => maturityTier === 'Silver')!;
    expect(rankVenues('', undefined, [silverOnly], overrides, undefined, referenceDate)).toEqual([]);
  });
});
