import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_BROWSER_EVENT,
  ANALYTICS_EVENT_NAMES,
  ANALYTICS_SCHEMA_VERSION,
  AnalyticsContractError,
  createAnalyticsDispatcher,
  createAnalyticsEvent,
  type AnalyticsEvent,
} from './events';

describe('analytics locale privacy-first', () => {
  it('espone la tassonomia PRD versionata senza eventi impliciti', () => {
    expect(ANALYTICS_SCHEMA_VERSION).toBe(1);
    expect(ANALYTICS_EVENT_NAMES).toEqual([
      'search_started',
      'intent_parsed',
      'podium_shown',
      'podium_low_confidence',
      'card_opened',
      'venue_saved',
      'podium_shared',
      'wildcard_explained',
      'wildcard_replaced',
      'feedback_submitted',
    ]);
  });

  it('valida un payload minimo per ciascun evento della tassonomia', () => {
    const validPayloads = {
      search_started: { entryPoint: 'home', hasFilters: false, hasLocationContext: false },
      intent_parsed: { constraintCount: 2, hardConstraintCount: 1, unsupportedConstraintCount: 0 },
      podium_shown: { resultCount: 3, hasWildcard: true, profileApplied: false },
      podium_low_confidence: { resultCount: 1, reason: 'insufficient_candidates' },
      card_opened: { venueId: 'lume-brera', rank: 1, role: 'best-fit' },
      venue_saved: { venueId: 'lume-brera', saved: true, source: 'podium' },
      podium_shared: { resultCount: 3, method: 'native', context: 'individual' },
      wildcard_explained: { venueId: 'quota-ventuno', divergenceDimension: 'zona' },
      wildcard_replaced: { venueId: 'quota-ventuno', replacementFound: true, divergenceDimension: 'zona' },
      feedback_submitted: { target: 'wildcard', code: 'too_far', venueId: 'quota-ventuno' },
    } as const;

    const events = ANALYTICS_EVENT_NAMES.map((name) => createAnalyticsEvent(name, validPayloads[name]));
    expect(events.map(({ name }) => name)).toEqual(ANALYTICS_EVENT_NAMES);
    expect(events.every(({ schemaVersion, properties }) => schemaVersion === 1 && Object.isFrozen(properties))).toBe(true);
  });

  it('crea un envelope tecnico, immutabile e idempotente', () => {
    const event = createAnalyticsEvent('card_opened', {
      venueId: 'lume-brera',
      rank: 1,
      role: 'best-fit',
    }, {
      eventId: 'evt-test-1',
      correlationId: 'corr-test-1',
      idempotencyKey: 'open:lume-brera:1',
      occurredAt: '2026-07-16T12:00:00.000Z',
    });

    expect(event).toEqual({
      schemaVersion: 1,
      name: 'card_opened',
      privacyClass: 'product_measurement',
      eventId: 'evt-test-1',
      correlationId: 'corr-test-1',
      idempotencyKey: 'open:lume-brera:1',
      occurredAt: '2026-07-16T12:00:00.000Z',
      properties: { venueId: 'lume-brera', rank: 1, role: 'best-fit' },
    });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.properties)).toBe(true);
  });

  it('rifiuta query raw, coordinate, PII e ogni proprietà fuori allowlist', () => {
    const unsafePayloads = [
      { entryPoint: 'home', hasFilters: false, hasLocationContext: false, rawQuery: 'cena per Mario' },
      { entryPoint: 'home', hasFilters: false, hasLocationContext: false, latitude: 45.46 },
      { entryPoint: 'home', hasFilters: false, hasLocationContext: false, email: 'mario@example.test' },
    ];

    for (const properties of unsafePayloads) {
      expect(() => createAnalyticsEvent('search_started', properties as never)).toThrow(AnalyticsContractError);
      expect(() => createAnalyticsEvent('search_started', properties as never)).toThrow(/proprietà non consentite/);
    }
  });

  it('valida conteggi, relazioni e ID invece di correggerli in silenzio', () => {
    expect(() => createAnalyticsEvent('podium_shown', {
      resultCount: 4,
      hasWildcard: true,
      profileApplied: false,
    })).toThrow(/resultCount/);

    expect(() => createAnalyticsEvent('intent_parsed', {
      constraintCount: 1,
      hardConstraintCount: 2,
      unsupportedConstraintCount: 0,
    })).toThrow(/hardConstraintCount/);

    expect(() => createAnalyticsEvent('podium_shown', {
      resultCount: 2,
      hasWildcard: true,
      profileApplied: false,
    })).toThrow(/podio completo/);

    expect(() => createAnalyticsEvent('card_opened', {
      venueId: 'lume-brera',
      rank: 1,
      role: 'smart-wildcard',
    })).toThrow(/role non coerente/);

    expect(() => createAnalyticsEvent('venue_saved', {
      venueId: 'Mario Rossi',
      saved: true,
      source: 'podium',
    })).toThrow(/slug tecnico/);
  });

  it('accetta una terza alternativa normale quando la wildcard non è sicura', () => {
    expect(createAnalyticsEvent('card_opened', {
      venueId: 'lume-brera',
      rank: 3,
      role: 'safe-alternative',
    }).properties.role).toBe('safe-alternative');
  });

  it('riusa una correlation ID e permette una chiave idempotente scelta dal chiamante', () => {
    const dispatcher = createAnalyticsDispatcher({ correlationId: 'corr-flow-1' });
    const first = dispatcher.emit('venue_saved', {
      venueId: 'lume-brera',
      saved: true,
      source: 'podium',
    }, { idempotencyKey: 'save:lume-brera:on' });
    const repeated = dispatcher.emit('venue_saved', {
      venueId: 'lume-brera',
      saved: true,
      source: 'podium',
    }, { idempotencyKey: 'save:lume-brera:on' });

    expect(first.correlationId).toBe('corr-flow-1');
    expect(repeated.correlationId).toBe('corr-flow-1');
    expect(first.eventId).not.toBe(repeated.eventId);
    expect(first.idempotencyKey).toBe(repeated.idempotencyKey);
  });

  it('usa soltanto CustomEvent locale e non implementa trasporto o storage', async () => {
    let received: AnalyticsEvent | undefined;
    let eventType = '';
    const target = {
      dispatchEvent(event: Event) {
        eventType = event.type;
        received = (event as CustomEvent<AnalyticsEvent>).detail;
        return true;
      },
    };
    const dispatcher = createAnalyticsDispatcher({ correlationId: 'corr-local-only', target });
    const emitted = dispatcher.emit('feedback_submitted', {
      target: 'wildcard',
      code: 'too_far',
      venueId: 'quota-ventuno',
    });

    expect(eventType).toBe(ANALYTICS_BROWSER_EVENT);
    expect(received).toEqual(emitted);

    const source = await readFile(resolve(process.cwd(), 'src/analytics/events.ts'), 'utf8');
    for (const forbiddenApi of ['fetch(', 'sendBeacon', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'document.cookie']) {
      expect(source).not.toContain(forbiddenApi);
    }
  });
});
