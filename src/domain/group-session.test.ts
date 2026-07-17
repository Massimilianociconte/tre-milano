import { describe, expect, it } from 'vitest';
import {
  GROUP_SESSION_MAX_PARTICIPANTS,
  GROUP_SESSION_MIN_PARTICIPANTS,
  GROUP_SESSION_VERSION,
  aggregateGroupPreferences,
  canonicalGroupSession,
  createGroupSession,
  createGroupSessionUrl,
  decodeGroupSession,
  encodeGroupSession,
  intersectGroupHardConstraints,
  rankGroupOptions,
  readGroupSessionFromUrl,
  type GroupSession,
} from './group-session';

const session: GroupSession = {
  version: GROUP_SESSION_VERSION,
  participants: [
    {
      intents: ['aperitivo', 'panoramico'],
      hard: { maxBudget: 3, maxMinutes: 30, areas: ['brera', 'duomo'] },
      vote: 'panoramico',
    },
    {
      intents: ['aperitivo', 'tranquillo'],
      hard: { maxBudget: 2, maxMinutes: 20, areas: ['duomo', 'navigli'] },
      vote: 'aperitivo',
    },
  ],
};

describe('sessione gruppo locale e anonima', () => {
  it('crea soltanto gruppi da due a sei partecipanti anonimi', () => {
    expect(createGroupSession().participants).toHaveLength(GROUP_SESSION_MIN_PARTICIPANTS);
    expect(createGroupSession(GROUP_SESSION_MAX_PARTICIPANTS).participants).toHaveLength(6);
    expect(createGroupSession().participants[0]).toEqual({ intents: [], hard: { areas: [] } });
    expect(() => createGroupSession(1)).toThrow(RangeError);
    expect(() => createGroupSession(7)).toThrow(RangeError);
  });

  it('rende canonici ordine e duplicati senza aggiungere identità o testo libero', () => {
    const canonical = canonicalGroupSession({
      version: 1,
      participants: [
        { intents: ['panoramico', 'aperitivo', 'panoramico'], hard: { areas: ['duomo', 'brera', 'duomo'] } },
        { intents: [], hard: { areas: [] } },
      ],
    });

    expect(canonical?.participants[0]).toEqual({
      intents: ['aperitivo', 'panoramico'],
      hard: { areas: ['brera', 'duomo'] },
    });
    expect(Object.keys(canonical?.participants[0] ?? {})).toEqual(['intents', 'hard']);
  });

  it('rifiuta versioni, tassonomie e limiti non validi invece di reinterpretarli', () => {
    expect(canonicalGroupSession({ version: 2, participants: session.participants })).toBeNull();
    expect(canonicalGroupSession({ version: 1, participants: [{ intents: ['testo libero'], hard: { areas: [] } }, session.participants[1]] })).toBeNull();
    expect(canonicalGroupSession({ version: 1, participants: [{ intents: [], hard: { areas: [], maxMinutes: 999 } }, session.participants[1]] })).toBeNull();
    expect(canonicalGroupSession({ version: 1, participants: [session.participants[0]] })).toBeNull();
  });

  it('produce un payload URL-safe, compatto, versionato e privo di copy o nomi', () => {
    const payload = encodeGroupSession(session);

    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(payload.length).toBeLessThan(260);
    expect(payload).not.toContain('Persona');
    expect(payload).not.toContain('aperitivo');
    expect(payload).not.toContain('Milano');
    expect(decodeGroupSession(payload)).toEqual(session);
  });

  it('serializza in modo deterministico anche da input riordinato', () => {
    const reordered: GroupSession = {
      ...session,
      participants: [
        {
          ...session.participants[0],
          intents: ['panoramico', 'aperitivo'],
          hard: { ...session.participants[0].hard, areas: ['duomo', 'brera'] },
        },
        session.participants[1],
      ],
    };
    expect(encodeGroupSession(reordered)).toBe(encodeGroupSession(session));
  });

  it('rifiuta payload corrotti, troppo grandi o con campi sconosciuti', () => {
    expect(decodeGroupSession('not*base64')).toBeNull();
    expect(decodeGroupSession('a'.repeat(2_049))).toBeNull();
    const unknownField = btoa(JSON.stringify({ v: 1, p: [{}, {}], raw: 'non consentito' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    expect(decodeGroupSession(unknownField)).toBeNull();
  });

  it('usa il frammento URL, elimina query estranee e reimporta link o payload', () => {
    const url = createGroupSessionUrl('https://tre.example/gruppo/?utm_source=test', session);

    expect(url).toMatch(/^https:\/\/tre\.example\/gruppo\/#g=/);
    expect(url).not.toContain('utm_source');
    expect(readGroupSessionFromUrl(url)).toEqual(session);
    expect(readGroupSessionFromUrl(new URL(url))).toEqual(session);
    expect(readGroupSessionFromUrl(`#g=${encodeGroupSession(session)}`)).toEqual(session);
    expect(readGroupSessionFromUrl(encodeGroupSession(session))).toEqual(session);
    expect(readGroupSessionFromUrl('https://tre.example/gruppo/#g=danneggiato')).toBeNull();
  });
});

describe('intersezione dei vincoli hard', () => {
  it('applica il limite più restrittivo e l’intersezione delle aree dichiarate', () => {
    expect(intersectGroupHardConstraints(session)).toEqual({
      maxBudget: 2,
      maxMinutes: 20,
      areas: ['duomo'],
      conflicts: [],
    });
  });

  it('tratta un insieme vuoto come qualsiasi area e rileva aree incompatibili', () => {
    const unrestricted: GroupSession = {
      version: 1,
      participants: [
        { intents: [], hard: { areas: [] } },
        { intents: [], hard: { areas: ['brera', 'duomo'] } },
      ],
    };
    expect(intersectGroupHardConstraints(unrestricted).areas).toEqual(['brera', 'duomo']);

    const conflict: GroupSession = {
      version: 1,
      participants: [
        { intents: [], hard: { areas: ['brera'] } },
        { intents: [], hard: { areas: ['navigli'] } },
      ],
    };
    expect(intersectGroupHardConstraints(conflict)).toEqual({ areas: [], conflicts: ['areas'] });
    expect(rankGroupOptions(conflict, [{ id: 'opzione', intents: ['aperitivo'], area: 'brera' }])).toEqual([]);
  });

  it('esclude in fail-closed opzioni senza i dati richiesti dai vincoli hard', () => {
    const ranked = rankGroupOptions(session, [
      { id: 'senza-dati', intents: ['aperitivo'] },
      { id: 'troppo-cara', intents: ['aperitivo'], area: 'duomo', budgetLevel: 3 as const, minutes: 10 },
      { id: 'troppo-lontana', intents: ['aperitivo'], area: 'duomo', budgetLevel: 2 as const, minutes: 30 },
      { id: 'zona-errata', intents: ['aperitivo'], area: 'brera', budgetLevel: 2 as const, minutes: 10 },
      { id: 'ammessa', intents: ['aperitivo'], area: 'duomo', budgetLevel: 2 as const, minutes: 15 },
    ]);

    expect(ranked.map(({ option }) => option.id)).toEqual(['ammessa']);
  });
});

describe('aggregazione deterministica e fairness max-regret', () => {
  const fairnessSession: GroupSession = {
    version: 1,
    participants: [
      { intents: ['aperitivo', 'panoramico'], hard: { areas: [] }, vote: 'panoramico' },
      { intents: ['aperitivo', 'tranquillo'], hard: { areas: [] }, vote: 'tranquillo' },
      { intents: ['aperitivo', 'conviviale'], hard: { areas: [] } },
    ],
  };

  it('privilegia il compromesso che minimizza il peggior rimpianto individuale', () => {
    const ranked = rankGroupOptions(fairnessSession, [
      { id: 'solo-panorama', intents: ['panoramico'] },
      { id: 'compromesso', intents: ['aperitivo'] },
      { id: 'solo-tranquillo', intents: ['tranquillo'] },
    ]);

    expect(ranked[0].option.id).toBe('compromesso');
    expect(ranked[0].maxRegret).toBeLessThan(ranked[1].maxRegret);
    expect(ranked[0].participantUtilities).toEqual([0.5, 0.5, 0.5]);
  });

  it('usa utilità media, sostenitori e id stabile come tie-break deterministici', () => {
    const options = [
      { id: 'zeta', intents: ['aperitivo' as const] },
      { id: 'alfa', intents: ['aperitivo' as const] },
    ];
    const direct = rankGroupOptions(fairnessSession, options);
    const reversed = rankGroupOptions(fairnessSession, [...options].reverse());

    expect(direct.map(({ option }) => option.id)).toEqual(['alfa', 'zeta']);
    expect(reversed.map(({ option }) => option.id)).toEqual(['alfa', 'zeta']);
  });

  it('restituisce una classifica di intenti spiegabile con il consenso comune davanti', () => {
    const ranked = aggregateGroupPreferences(fairnessSession);

    expect(ranked[0]).toMatchObject({ intent: 'aperitivo', supporters: 0, maxRegret: 0.25 });
    expect(ranked).toHaveLength(10);
    expect(new Set(ranked.map(({ intent }) => intent)).size).toBe(10);
  });

  it('mantiene il riepilogo tassonomico anche quando i vincoli richiedono fatti da locale', () => {
    expect(aggregateGroupPreferences(session)).toHaveLength(10);
    expect(aggregateGroupPreferences(session)[0].intent).toBe('aperitivo');
  });
});
