import { describe, expect, it } from 'vitest';
import { parseIntent } from '../ranking/rank';
import {
  SEARCH_INTERPRETATION_VERSION,
  hasSearchPrivacyRisk,
  interpretationFromLocalIntent,
  interpretationToRankingOverrides,
  isSearchInterpretationResponseV1,
  reconcileRemoteIntent,
  shouldUseRemoteInterpretation,
  validateRemoteIntentPayload,
  validateSearchQuery,
  type RemoteIntentPayloadV1,
} from './interpretation-contract';

const emptyRemote = (overrides: Partial<RemoteIntentPayloadV1> = {}): RemoteIntentPayloadV1 => ({
  signals: [],
  minSpend: null,
  maxSpend: null,
  maxMinutes: null,
  requiresOpenNow: false,
  serviceTime: null,
  travelOrigin: 'none',
  unsupportedConstraintCodes: [],
  semanticHints: [],
  ...overrides,
});

describe('contratto query e privacy', () => {
  it('normalizza lo spazio e applica il limite di 320 caratteri', () => {
    expect(validateSearchQuery('  un   posto intimo  ')).toEqual({ ok: true, query: 'un posto intimo' });
    expect(validateSearchQuery('a')).toEqual({ ok: false });
    expect(validateSearchQuery('a'.repeat(321))).toEqual({ ok: false });
    expect(validateSearchQuery(`posto\u0000intimo`)).toEqual({ ok: false });
  });

  it.each([
    'scrivimi a mario@example.it',
    'chiamami al +39 333 123 4567',
    'guarda https://example.it/profilo',
    'mi chiamo Mario e cerco un aperitivo',
    'mario rossi',
    'un posto intimo come casa di mario rossi',
    'prenotazione per giulia bianchi',
    'prenotazione a nome di john smith',
    'un posto intimo come casa di Mario Rossi in via Torino 10',
    'un aperitivo vicino a piazzale loreto 5',
    'un aperitivo vicino a p.le loreto 5',
    'un posto tranquillo per parlare di diabete tipo due',
    'un locale tranquillo per una persona con autismo',
    'un posto tranquillo per parlare della sieropositività di mia figlia',
    'sono celiaco e cerco una cena',
    'cerco un locale legato al partito politico che voto',
  ])('intercetta prima del provider: %s', (query) => {
    expect(hasSearchPrivacyRisk(query)).toBe(true);
    expect(shouldUseRemoteInterpretation(query, parseIntent(query))).toBe(false);
  });

  it('non confonde budget, orari o occasioni ordinarie con dati sensibili', () => {
    expect(hasSearchPrivacyRisk('aperitivo romantico sotto 40 euro alle 20:30')).toBe(false);
    expect(hasSearchPrivacyRisk('cocktail bar creativo con musica dal vivo')).toBe(false);
    expect(hasSearchPrivacyRisk('un posto che sembri uscito da un film e faccia colpo senza essere rumoroso')).toBe(false);
  });

  it('usa il remoto soltanto quando aggiunge valore', () => {
    const simple = 'aperitivo elegante a Brera';
    const expressive = 'un posto che sembri uscito da un film e faccia colpo senza essere rumoroso';
    expect(shouldUseRemoteInterpretation(simple, parseIntent(simple))).toBe(false);
    expect(shouldUseRemoteInterpretation(expressive, parseIntent(expressive))).toBe(true);
    expect(shouldUseRemoteInterpretation('sono celiaco e voglio cenare', parseIntent('sono celiaco e voglio cenare'))).toBe(false);
    expect(shouldUseRemoteInterpretation('entro 45 minuti a piedi', parseIntent('entro 45 minuti a piedi'))).toBe(false);
  });
});

describe('validazione output remoto', () => {
  it('accetta soltanto tassonomia e shape chiuse', () => {
    expect(validateRemoteIntentPayload(emptyRemote({
      signals: [
        { dimension: 'occasion', value: 'appuntamento', mode: 'prefer' },
        { dimension: 'atmosphere', value: 'intimo', mode: 'require' },
      ],
      maxSpend: 50,
      semanticHints: ['fare colpo'],
    }))).not.toBeNull();
  });

  it('rifiuta venue, valori fuori enum, duplicati e limiti incoerenti', () => {
    expect(validateRemoteIntentPayload({ ...emptyRemote(), venueId: 'notturno' })).toBeNull();
    expect(validateRemoteIntentPayload(emptyRemote({
      signals: [{ dimension: 'category', value: 'Discoteca', mode: 'prefer' }],
    }))).toBeNull();
    expect(validateRemoteIntentPayload(emptyRemote({
      signals: [
        { dimension: 'concept', value: 'design', mode: 'prefer' },
        { dimension: 'concept', value: 'design', mode: 'exclude' },
      ],
    }))).toBeNull();
    expect(validateRemoteIntentPayload(emptyRemote({ minSpend: 90, maxSpend: 40 }))).toBeNull();
    expect(validateRemoteIntentPayload(emptyRemote({
      signals: [{ dimension: 'occasion', value: 'aperitivo', mode: 'require' }],
    }))).toBeNull();
  });
});

describe('riconciliazione fail-closed con il ranker', () => {
  it('arricchisce i segnali morbidi senza scegliere locali', () => {
    const local = parseIntent('vorrei fare colpo con una serata particolare');
    const interpreted = reconcileRemoteIntent(local, emptyRemote({
      signals: [
        { dimension: 'occasion', value: 'appuntamento', mode: 'prefer' },
        { dimension: 'atmosphere', value: 'elegante', mode: 'prefer' },
        { dimension: 'concept', value: 'design', mode: 'prefer' },
      ],
      semanticHints: ['sorprendente'],
    }));
    expect(interpreted.occasions).toContain('appuntamento');
    expect(interpreted.atmosphere).toContain('elegante');
    expect(interpreted.concepts).toContain('design');
    expect(interpreted.semanticTokens).toContain('sorprendente');
    expect(interpreted).not.toHaveProperty('venueId');
  });

  it('non rimuove vincoli duri locali e mantiene autorevoli i limiti numerici già interpretati', () => {
    const local = parseIntent('solo rooftop, senza musica, sotto 60 euro, entro 20 minuti');
    const interpreted = reconcileRemoteIntent(local, emptyRemote({
      signals: [
        { dimension: 'category', value: 'Rooftop', mode: 'exclude' },
        { dimension: 'concept', value: 'musica', mode: 'require' },
      ],
      maxSpend: 45,
      maxMinutes: 30,
    }));
    expect(interpreted.requiredCategories).toContain('Rooftop');
    expect(interpreted.excludedCategories).not.toContain('Rooftop');
    expect(interpreted.excludedConcepts).toContain('musica');
    expect(interpreted.requiredConcepts).not.toContain('musica');
    expect(interpreted.maxSpend).toBe(60);
    expect(interpreted.maxMinutes).toBe(20);
  });

  it('accetta valori remoti validati quando colmano un vuoto supportato dalla query esplicita', () => {
    const interpreted = reconcileRemoteIntent(parseIntent(
      'budget di una cinquantina di euro, una ventina di minuti a piedi dal Duomo, venerdì per le otto e mezza, aperto in questo momento',
    ), emptyRemote({
      minSpend: 40,
      maxSpend: 50,
      maxMinutes: 20,
      requiresOpenNow: true,
      serviceTime: { weekday: 5, minutes: 1_230 },
      travelOrigin: 'duomo',
    }));
    expect(interpreted).toMatchObject({
      minSpend: 40,
      maxSpend: 50,
      maxMinutes: 20,
      requiresOpenNow: true,
      requestedServiceTime: { weekday: 5, minutes: 1_230, label: 'alle 20:30' },
      travelOriginId: 'milano-duomo-centroid',
    });
  });

  it('ignora budget, apertura, orario e origine remoti senza evidenza testuale esplicita', () => {
    const interpreted = reconcileRemoteIntent(parseIntent('serata particolare'), emptyRemote({
      minSpend: 40,
      maxSpend: 70,
      maxMinutes: 15,
      requiresOpenNow: true,
      serviceTime: { weekday: 5, minutes: 1_230 },
      travelOrigin: 'duomo',
    }));
    expect(interpreted).toMatchObject({
      minSpend: null,
      maxSpend: null,
      maxMinutes: null,
      requiresOpenNow: false,
      requestedServiceTime: null,
      travelOriginId: null,
    });
  });

  it('non elimina gli unsupported locali e rende non supportata una origine remota non verificabile', () => {
    const local = parseIntent('ristorante accessibile in sedia a rotelle');
    const interpreted = reconcileRemoteIntent(local, emptyRemote({ travelOrigin: 'unsupported' }));
    expect(interpreted.unsupportedConstraints.map(({ code }) => code)).toEqual(
      expect.arrayContaining(['ACCESSIBILITY', 'TRAVEL_ORIGIN']),
    );
  });

  it('produce override compatibili con applyRankingOverrides', () => {
    const interpreted = reconcileRemoteIntent(parseIntent('serata speciale sotto 80 euro'), emptyRemote({
      signals: [{ dimension: 'occasion', value: 'occasione speciale', mode: 'prefer' }],
      maxSpend: 60,
    }));
    expect(interpretationToRankingOverrides(interpreted)).toMatchObject({
      occasions: ['occasione speciale'],
      maxSpend: 80,
    });
  });
});

describe('validator risposta client', () => {
  it('accetta una risposta esatta e rifiuta metadata, intent o fallback incoerenti', () => {
    const intent = interpretationFromLocalIntent(parseIntent('aperitivo elegante'));
    const valid = {
      version: SEARCH_INTERPRETATION_VERSION,
      source: 'deepseek',
      interpreter: { provider: 'deepseek', model: 'deepseek-v4-flash' },
      intent,
    };
    expect(isSearchInterpretationResponseV1(valid)).toBe(true);
    expect(isSearchInterpretationResponseV1({ ...valid, query: 'aperitivo elegante' })).toBe(false);
    expect(isSearchInterpretationResponseV1({ ...valid, interpreter: { provider: 'deepseek', model: 'altro' } })).toBe(false);
    expect(isSearchInterpretationResponseV1({ ...valid, intent: { ...intent, categories: ['Discoteca'] } })).toBe(false);
    expect(isSearchInterpretationResponseV1({ ...valid, source: 'deterministic-fallback' })).toBe(false);
    expect(isSearchInterpretationResponseV1({
      ...valid,
      source: 'deterministic-fallback',
      fallbackReason: 'timeout',
    })).toBe(true);
  });
});
