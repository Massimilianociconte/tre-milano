import { describe, expect, it } from 'vitest';
import { venues } from '../data/venues';
import { buildSessionTravelEstimates } from '../domain/discovery-location';
import { createEmptyTasteProfile, type TasteProfile } from '../domain/taste-profile';
import type { Venue } from '../domain/venue';
import { RANKING_THRESHOLDS, RANKING_VERSION, RANKING_WEIGHTS } from './config';
import { normaliseItalian, parseIntent, rankVenues, respectsHardConstraints } from './rank';

const runtimeReferenceDate = new Date('2026-07-16T20:00:00+02:00');

function runtimeGoldVenue(overrides: Partial<Venue> = {}): Venue {
  const fixture = venues[0];
  return {
    ...fixture,
    fixtureOnly: false,
    verifiedAt: '2026-07-16',
    confidence: 0.9,
    openStatus: {
      ...fixture.openStatus,
      checkedAt: '2026-07-16T18:00:00+02:00',
      validUntil: '2026-07-17T02:00:00+02:00',
      source: 'official',
      sourceUrl: 'https://venue.test-domain.it/orari',
    },
    availability: {
      ...fixture.availability,
      checkedAt: '2026-07-16T18:00:00+02:00',
      validUntil: '2026-08-16T18:00:00+02:00',
      source: 'official',
      sourceUrl: 'https://venue.test-domain.it/orari',
    },
    travelEstimate: {
      ...fixture.travelEstimate,
      checkedAt: '2026-07-16T18:00:00+02:00',
      validUntil: '2026-07-17T18:00:00+02:00',
      source: 'routing',
      sourceUrl: 'https://routing.test-domain.it/walk/duomo/venue',
    },
    provenance: {
      pricing: {
        source: 'official',
        sourceUrl: 'https://venue.test-domain.it/menu',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-10-01T18:00:00+02:00',
        confidence: 0.9,
      },
      attributes: {
        source: 'editorial',
        sourceUrl: 'https://tre-milano.it/fonti/venue',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-10-01T18:00:00+02:00',
        confidence: 0.9,
      },
      imageRights: {
        source: 'editorial',
        sourceUrl: 'https://tre-milano.it/licenze/venue',
        checkedAt: '2026-07-16T18:00:00+02:00',
        validUntil: '2026-10-01T18:00:00+02:00',
        confidence: 0.9,
        rightsStatus: 'licensed',
        rightsHolder: 'Fotografo di prova',
      },
    },
    ...overrides,
  };
}

describe('normalizzazione italiana', () => {
  it('espone una configurazione ranking versionata e priva di magic number nel contratto pubblico', () => {
    expect(RANKING_VERSION).toBe('deterministic-local-v3');
    expect(RANKING_THRESHOLDS.explanationReasonLimit).toBe(3);
    expect(RANKING_WEIGHTS.confidence).toBeGreaterThan(0);
    expect(Object.isFrozen(RANKING_THRESHOLDS)).toBe(true);
    expect(Object.isFrozen(RANKING_WEIGHTS)).toBe(true);
  });

  it('normalizza accenti, apostrofi tipografici e punteggiatura', () => {
    expect(normaliseItalian('Caffè d’autore, all’Isola!')).toBe('caffe d autore all isola');
  });

  it('comprende sinonimi italiani e inglesi senza dipendere da un modello remoto', () => {
    const intent = parseIntent('Wine bar chic con dehors per happy hour');
    expect(intent.categories).toContain('Enoteca');
    expect(intent.atmosphere).toContain('elegante');
    expect(intent.occasions).toContain('aperitivo');
    expect(intent.concepts).toContain('spazio all’aperto');
  });
});

describe('estrazione multi-intento', () => {
  it('estrae quartiere, atmosfera e occasione', () => {
    const intent = parseIntent('Aperitivo tranquillo a Brera stasera', undefined, new Date('2026-07-16T12:00:00+02:00'));
    expect(intent.neighborhood).toBe('Brera');
    expect(intent.atmosphere).toContain('tranquillo');
    expect(intent.occasion).toBe('aperitivo');
    expect(intent.requiresOpenNow).toBe(false);
    expect(intent.requestedServiceTime).toEqual({ weekday: 4, minutes: 20 * 60 + 30, label: 'alle 20:30' });
  });

  it('mantiene più categorie positive in ordine di menzione', () => {
    const intent = parseIntent('Vorrei un rooftop oppure un cocktail bar elegante');
    expect(intent.categories).toEqual(['Rooftop', 'Cocktail bar']);
    expect(intent.category).toBe('Rooftop');
  });

  it('comprende occasioni e mood espressi in linguaggio naturale', () => {
    const intent = parseIntent('Un posto raccolto per festeggiare un anniversario con la mia compagna');
    expect(intent.atmosphere).toContain('intimo');
    expect(intent.occasions).toContain('occasione speciale');
  });

  it('l’intento selezionato dalla UI è autorevole e indipendente dalla query', () => {
    const intent = parseIntent('un posto elegante', 'Cena romantica');
    expect(intent.occasion).toBe('cena romantica');
    expect(intent.occasions[0]).toBe('cena romantica');
  });

  it('riconosce attributi semantici non riducibili alla categoria', () => {
    const intent = parseIntent('Dove posso parlare con calma, ai tavoli fuori, guardando il tramonto?');
    expect(intent.concepts).toEqual(expect.arrayContaining(['conversazione', 'spazio all’aperto', 'tramonto']));
  });

  it('riconosce i quartieri del catalogo reale oltre alle sei zone fixture', () => {
    expect(parseIntent('una pasticceria raffinata vicino a Porta Venezia').neighborhood).toBe('Porta Venezia');
    expect(parseIntent('rooftop vicino al Monumentale').neighborhood).toBe('Monumentale');
    expect(parseIntent('cocktail bar nel Quadrilatero della moda').neighborhood).toBe('Quadrilatero della moda');
  });

  it('normalizza gli alias colloquiali dei quartieri sul nome canonico', () => {
    expect(parseIntent('un drink in zona Montenapoleone').neighborhood).toBe('Quadrilatero della moda');
    expect(parseIntent('aperitivo in corso como').neighborhood).toBe('Porta Garibaldi');
    expect(parseIntent('cena sul naviglio grande').neighborhood).toBe('Navigli');
    expect(parseIntent('brunch in zona chinatown').neighborhood).toBe('Sarpi');
    expect(parseIntent('caffè alle colonne di san lorenzo').neighborhood).toBe('Porta Ticinese');
  });

  it('gestisce esclusioni e requisiti anche sui quartieri estesi', () => {
    const excluded = parseIntent('cocktail bar ma non in porta venezia');
    expect(excluded.excludedNeighborhoods).toContain('Porta Venezia');
    expect(excluded.neighborhoods).not.toContain('Porta Venezia');

    const required = parseIntent('solo in zona monumentale');
    expect(required.requiredNeighborhoods).toContain('Monumentale');
  });
});

describe('vincoli duri prima del ranking', () => {
  it('usa le stime di sessione per maxMinutes senza mutare il tempo Gold', () => {
    const originalTravel = structuredClone(venues.map(({ travelEstimate }) => travelEstimate));
    const sessionTravelEstimates = buildSessionTravelEstimates(
      venues,
      { latitude: 45.452, longitude: 9.202 },
    );
    const results = rankVenues(
      'entro 8 minuti a piedi',
      undefined,
      venues,
      {},
      undefined,
      runtimeReferenceDate,
      { sessionTravelEstimates },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ sessionTravelEstimate }) => (
      sessionTravelEstimate !== undefined && sessionTravelEstimate.minutes <= 8
    ))).toBe(true);
    expect(results.every(({ sessionTravelEstimate }) => sessionTravelEstimate?.disclosure === 'stimata, non routing')).toBe(true);
    expect(venues.map(({ travelEstimate }) => travelEstimate)).toEqual(originalTravel);
  });

  it('non viola un budget massimo', () => {
    const query = 'aperitivo sotto 30 euro stasera';
    const intent = parseIntent(query);
    const results = rankVenues(query);
    expect(results).toHaveLength(1);
    expect(results.every((venue) => respectsHardConstraints(venue, intent))).toBe(true);
    expect(results.every((venue) => venue.averageSpend <= 30)).toBe(true);
  });

  it('distingue distanza e budget e applica entrambi', () => {
    const intent = parseIntent('aperitivo entro 12 minuti sotto 40 euro');
    const results = rankVenues(intent.query);
    expect(intent.maxMinutes).toBe(12);
    expect(intent.maxSpend).toBe(40);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((venue) => venue.travelEstimate.minutes <= 12 && venue.averageSpend <= 40)).toBe(true);
  });

  it('comprende le varianti meno di e non più di', () => {
    const intent = parseIntent('cena con meno di 60 euro e non più di 15 minuti');
    expect(intent.maxSpend).toBe(60);
    expect(intent.maxMinutes).toBe(15);
  });

  it('comprende budget e distanza espressi nel linguaggio quotidiano', () => {
    expect(parseIntent('qualcosa di economico').maxSpend).toBe(35);
    expect(parseIntent('voglio spendere poco').maxSpend).toBe(35);
    expect(parseIntent('non troppo costoso').maxSpend).toBe(35);
    expect(parseIntent('a meno di 10 minuti').maxMinutes).toBe(10);
    expect(parseIntent('10 minuti a piedi').maxMinutes).toBe(10);
    expect(parseIntent('entro un quarto d’ora').maxMinutes).toBe(15);
    expect(parseIntent('circa 40 euro a persona').maxSpend).toBe(40);
    expect(parseIntent('40 euro a persona').maxSpend).toBe(40);
    expect(parseIntent('tra 30 e 40 euro')).toMatchObject({ minSpend: 30, maxSpend: 40 });
    expect(parseIntent('tra 40 e 30 euro')).toMatchObject({ minSpend: 30, maxSpend: 40 });
    expect(parseIntent('tra €30 e €40')).toMatchObject({ minSpend: 30, maxSpend: 40 });
    expect(parseIntent('budget: 40 euro').maxSpend).toBe(40);
    expect(parseIntent('15 minuti dal Duomo')).toMatchObject({
      maxMinutes: 15,
      travelOriginId: 'milano-duomo-centroid',
      neighborhoods: [],
    });
    expect(parseIntent('15 minuti da Brera').unsupportedConstraints.map(({ code }) => code)).toContain('TRAVEL_ORIGIN');

    const affordable = rankVenues('economico');
    const walking = rankVenues('10 minuti a piedi');
    const range = rankVenues('tra 30 e 40 euro');
    expect(affordable.length).toBeGreaterThan(0);
    expect(walking.length).toBeGreaterThan(0);
    expect(range.length).toBeGreaterThan(0);
    expect(affordable.every((venue) => venue.averageSpend <= 35)).toBe(true);
    expect(walking.every((venue) => venue.travelEstimate.minutes <= 10)).toBe(true);
    expect(range.every((venue) => venue.averageSpend >= 30 && venue.averageSpend <= 40)).toBe(true);
  });

  it('comprende il simbolo euro con o senza spazio', () => {
    expect(parseIntent('aperitivo sotto 35€').maxSpend).toBe(35);
    expect(parseIntent('aperitivo sotto 35 €').maxSpend).toBe(35);
  });

  it('comprende il simbolo euro prima della cifra e come budget sintetico', () => {
    expect(parseIntent('cocktail massimo €40').maxSpend).toBe(40);
    expect(parseIntent('cocktail non più di €40').maxSpend).toBe(40);
    expect(parseIntent('aperitivo a Brera €30').maxSpend).toBe(30);
    const results = rankVenues('aperitivo €30');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((venue) => venue.averageSpend <= 30)).toBe(true);
  });

  it('rispetta una categoria esclusa senza confonderla con quella richiesta', () => {
    const intent = parseIntent('aperitivo senza cocktail bar, magari in enoteca');
    const results = rankVenues(intent.query);
    expect(intent.excludedCategories).toContain('Cocktail bar');
    expect(intent.categories).toContain('Enoteca');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((venue) => venue.category !== 'Cocktail bar')).toBe(true);
  });

  it('tratta solo + categoria come requisito e non come semplice preferenza', () => {
    const intent = parseIntent('solo un rooftop con vista');
    const results = rankVenues(intent.query);
    expect(intent.requiredCategories).toEqual(['Rooftop']);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((venue) => venue.category === 'Rooftop')).toBe(true);
  });

  it('applica esclusioni di quartiere, atmosfera e feature', () => {
    const query = 'aperitivo non ai Navigli, non troppo vivace e senza musica';
    const intent = parseIntent(query);
    const results = rankVenues(query);
    expect(intent.excludedNeighborhoods).toContain('Navigli');
    expect(intent.excludedAtmosphere).toContain('vivace');
    expect(intent.excludedConcepts).toContain('musica');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((venue) => venue.neighborhood !== 'Navigli')).toBe(true);
    expect(results.every((venue) => !venue.atmosphere.includes('vivace'))).toBe(true);
    expect(results.every((venue) => !venue.features.includes('musica'))).toBe(true);
  });

  it('comprende negazioni naturali anche quando soggetto e attributo non sono adiacenti', () => {
    expect(parseIntent('non voglio un posto con musica').excludedConcepts).toContain('musica');
    expect(parseIntent('evita i locali con musica').excludedConcepts).toContain('musica');
    expect(parseIntent('non mi piace la musica').excludedConcepts).toContain('musica');
    expect(parseIntent('non voglio andare ai Navigli').excludedNeighborhoods).toContain('Navigli');
    expect(parseIntent('non deve avere musica').excludedConcepts).toContain('musica');
    expect(parseIntent('non deve esserci musica').excludedConcepts).toContain('musica');
    expect(parseIntent('dove non ci sia musica').excludedConcepts).toContain('musica');
    expect(parseIntent('non deve avere musica').requiredConcepts).not.toContain('musica');
    expect(parseIntent('non vorrei musica').excludedConcepts).toContain('musica');
    expect(parseIntent('non mi interessa la musica').excludedConcepts).toContain('musica');

    const quietMusic = parseIntent('cocktail bar con opzioni vegane e senza musica vivace');
    expect(quietMusic.excludedConcepts).toContain('musica');
    expect(quietMusic.excludedAtmosphere).toContain('vivace');
    expect(quietMusic.atmosphere).not.toContain('vivace');
  });

  it('propaga le esclusioni coordinate senza trasformarle in preferenze', () => {
    expect(parseIntent('senza cocktail bar né rooftop').excludedCategories).toEqual(expect.arrayContaining(['Cocktail bar', 'Rooftop']));
    expect(parseIntent('niente Brera e Navigli').excludedNeighborhoods).toEqual(expect.arrayContaining(['Brera', 'Navigli']));
    expect(parseIntent('tutto tranne Brera e Navigli').excludedNeighborhoods).toEqual(expect.arrayContaining(['Brera', 'Navigli']));
  });

  it('propaga anche requisiti coordinati come alternative o condizioni cumulative', () => {
    expect(parseIntent('solo ristoranti o cocktail bar').requiredCategories).toEqual(['Ristorante', 'Cocktail bar']);
    expect(parseIntent('solo Brera e Navigli').requiredNeighborhoods).toEqual(['Brera', 'Navigli']);
    expect(parseIntent('solo Brera oppure Navigli').requiredNeighborhoods).toEqual(['Brera', 'Navigli']);
    expect(parseIntent('solo cocktail bar oppure rooftop').requiredCategories).toEqual(['Cocktail bar', 'Rooftop']);
    expect(parseIntent('deve essere intimo e tranquillo').requiredAtmosphere).toEqual(['intimo', 'tranquillo']);
    expect(parseIntent('deve essere intimo ma anche tranquillo').requiredAtmosphere).toEqual(['intimo', 'tranquillo']);
    expect(parseIntent('deve essere intimo oppure tranquillo').requiredAtmosphereAny).toEqual(['intimo', 'tranquillo']);
    expect(parseIntent('solo aperitivo').requiredOccasions).toEqual(['aperitivo']);

    const colloquialMood = parseIntent('solo qualcosa di scenografico, senza essere rumoroso');
    expect(colloquialMood.requiredAtmosphere).toEqual(['creativo']);
    expect(colloquialMood.excludedAtmosphere).toEqual(['vivace']);
    expect(colloquialMood.atmosphere).not.toContain('vivace');

    const categoryResults = rankVenues('solo ristoranti o cocktail bar');
    expect(categoryResults.length).toBeGreaterThan(0);
    expect(categoryResults.every((venue) => ['Ristorante', 'Cocktail bar'].includes(venue.category))).toBe(true);

    const moodResults = rankVenues('deve essere intimo e tranquillo');
    expect(moodResults.length).toBeGreaterThan(0);
    expect(moodResults.every((venue) => venue.atmosphere.includes('intimo') && venue.atmosphere.includes('tranquillo'))).toBe(true);

    const alternativeMoodResults = rankVenues('deve essere intimo oppure tranquillo');
    expect(alternativeMoodResults.length).toBeGreaterThan(0);
    expect(alternativeMoodResults.every((venue) => venue.atmosphere.includes('intimo') || venue.atmosphere.includes('tranquillo'))).toBe(true);

    const requiredOccasionResults = rankVenues('solo aperitivo');
    expect(requiredOccasionResults.length).toBeGreaterThan(0);
    expect(requiredOccasionResults.every((venue) => venue.occasions.includes('aperitivo'))).toBe(true);

    const multiClause = parseIntent('solo cocktail bar oppure rooftop; deve essere elegante e tranquillo');
    expect(multiClause.requiredCategories).toEqual(['Cocktail bar', 'Rooftop']);
    expect(multiClause.requiredAtmosphere).toEqual(['elegante', 'tranquillo']);
    expect(multiClause.requiredAtmosphereAny).toEqual([]);
    const multiClauseResults = rankVenues(multiClause.query);
    expect(multiClauseResults.length).toBeGreaterThan(0);
    expect(multiClauseResults.every((venue) => venue.atmosphere.includes('elegante') && venue.atmosphere.includes('tranquillo'))).toBe(true);
  });

  it('limita negazioni e requisiti alla clausola corretta', () => {
    const categoryIntent = parseIntent('senza musica, cocktail bar o rooftop');
    const neighborhoodIntent = parseIntent('niente Brera; meglio Navigli o Duomo');

    expect(categoryIntent.excludedConcepts).toContain('musica');
    expect(categoryIntent.excludedCategories).not.toContain('Cocktail bar');
    expect(categoryIntent.excludedCategories).not.toContain('Rooftop');
    expect(categoryIntent.categories).toEqual(expect.arrayContaining(['Cocktail bar', 'Rooftop']));
    expect(neighborhoodIntent.excludedNeighborhoods).toContain('Brera');
    expect(neighborhoodIntent.excludedNeighborhoods).not.toContain('Navigli');
    expect(neighborhoodIntent.excludedNeighborhoods).not.toContain('Duomo');
    expect(neighborhoodIntent.neighborhoods).toEqual(expect.arrayContaining(['Navigli', 'Duomo']));
  });

  it('tratta le modalità non obbligatorie come neutrali, non come esclusioni', () => {
    const mood = parseIntent('non necessariamente intimo');
    const elegance = parseIntent('non per forza elegante');
    const neighborhood = parseIntent('non per forza a Brera');
    const quiet = parseIntent('non è necessario che sia tranquillo');
    const category = parseIntent('non necessariamente un rooftop');
    const concept = parseIntent('non deve per forza avere vista Duomo');

    expect(mood.atmosphere).not.toContain('intimo');
    expect(mood.requiredAtmosphere).not.toContain('intimo');
    expect(mood.excludedAtmosphere).not.toContain('intimo');
    expect(elegance.atmosphere).not.toContain('elegante');
    expect(elegance.excludedAtmosphere).not.toContain('elegante');
    expect(neighborhood.neighborhoods).not.toContain('Brera');
    expect(neighborhood.excludedNeighborhoods).not.toContain('Brera');
    expect(quiet.atmosphere).not.toContain('tranquillo');
    expect(category.categories).not.toContain('Rooftop');
    expect(concept.concepts).not.toContain('vista Duomo');
    expect(rankVenues('non è necessario che sia tranquillo').every((venue) => !venue.reasonCodes.includes('ATMOSPHERE_MATCH'))).toBe(true);
  });

  it('non interpreta "non necessariamente aperto ora" come vincolo', () => {
    const intent = parseIntent('brunch non necessariamente aperto ora');
    expect(intent.requiresOpenNow).toBe(false);
  });

  it('non trasforma una sera esplicitamente negata in un vincolo di apertura', () => {
    const negatedOpening = parseIntent('cocktail non necessariamente aperto stasera');
    expect(negatedOpening.requiresOpenNow).toBe(false);
    expect(negatedOpening.requestedServiceTime).toBeUndefined();
    expect(parseIntent('un posto elegante, ma non stasera').requestedServiceTime).toBeUndefined();
    expect(parseIntent('non necessariamente aperto alle 22:30, cocktail bar').requestedServiceTime).toBeUndefined();
  });

  it('non scambia espressioni temporali generiche per aperto adesso', () => {
    expect(parseIntent("entro un quarto d'ora").requiresOpenNow).toBe(false);
    expect(parseIntent('un rooftop per la golden hour, ora dorata').requiresOpenNow).toBe(false);
  });

  it('usa le disponibilità settimanali per orari e giorni specifici', () => {
    const referenceDate = new Date('2026-07-16T12:00:00+02:00');
    const tonight = parseIntent('un cocktail bar aperto alle 22:30', undefined, referenceDate);
    const tomorrow = parseIntent('cena domani alle 20', undefined, referenceDate);

    expect(tonight.unsupportedConstraints).toHaveLength(0);
    expect(tonight.requestedServiceTime).toEqual({ weekday: 4, minutes: 22 * 60 + 30, label: 'alle 22:30' });
    expect(tomorrow.requestedServiceTime).toEqual({ weekday: 5, minutes: 20 * 60, label: 'alle 20:00' });
    expect(rankVenues('un cocktail bar aperto alle 22:30', undefined, venues, {}, undefined, referenceDate).map(({ id }) => id))
      .toEqual(expect.arrayContaining(['lume-brera', 'ombra-moscova']));
    expect(rankVenues('cena domani alle 20', undefined, venues, {}, undefined, referenceDate).map(({ id }) => id))
      .toEqual(['sala-nove']);
    expect(parseIntent('cena domani', undefined, referenceDate).unsupportedConstraints[0]?.code).toBe('EXACT_OPENING_TIME');
  });

  it('distingue stasera dallo stato aperto ora', () => {
    const referenceDate = new Date('2026-07-16T12:00:00+02:00');
    const results = rankVenues('stasera', undefined, venues, {}, undefined, referenceDate);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ id }) => id !== 'dispensa-isola')).toBe(true);
    expect(parseIntent('aperto ora', undefined, referenceDate).requiresOpenNow).toBe(true);
  });

  it('interpreta dopo mezzanotte come la prossima finestra notturna', () => {
    const referenceDate = new Date('2026-07-16T12:00:00+02:00');
    expect(parseIntent('stasera dopo mezzanotte', undefined, referenceDate).requestedServiceTime)
      .toEqual({ weekday: 5, minutes: 30, label: 'dopo mezzanotte' });
    expect(parseIntent('domani dopo mezzanotte', undefined, referenceDate).requestedServiceTime)
      .toEqual({ weekday: 5, minutes: 30, label: 'dopo mezzanotte' });
  });

  it('non indovina requisiti alimentari o di accessibilità safety-critical', () => {
    expect(parseIntent('aperitivo senza glutine').unsupportedConstraints.map(({ code }) => code)).toContain('DIETARY_SAFETY');
    expect(parseIntent('cena senza lattosio').unsupportedConstraints.map(({ code }) => code)).toContain('DIETARY_SAFETY');
    expect(parseIntent('opzioni vegane obbligatorie').requiredConcepts).toContain('opzioni vegane');
    expect(parseIntent('opzioni vegane obbligatorie').unsupportedConstraints).toHaveLength(0);
    expect(parseIntent('ristorante accessibile in sedia a rotelle').unsupportedConstraints.map(({ code }) => code)).toContain('ACCESSIBILITY');
    expect(rankVenues('aperitivo senza glutine')).toHaveLength(0);
    expect(parseIntent('facilmente accessibile con la metro').unsupportedConstraints).toHaveLength(0);
  });

  it('non soddisfa vincoli duri con affermazioni negate nel catalogo', () => {
    const poisoned = runtimeGoldVenue({
      id: 'poisoned-live',
      features: [],
      occasions: [],
      semanticTags: [
        'non offre opzioni vegane',
        'opzioni vegane non sono disponibili',
        'opzioni vegane al momento non sono garantite',
        'opzioni vegane solo su richiesta, non sempre disponibili',
        'aperitivo non disponibile',
      ],
    });
    expect(rankVenues(
      'opzioni vegane obbligatorie',
      undefined,
      [poisoned],
      {},
      undefined,
      runtimeReferenceDate,
    )).toEqual([]);
    expect(rankVenues('solo aperitivo', undefined, [poisoned], {}, undefined, runtimeReferenceDate)).toEqual([]);
  });

  it('non interpreta l’assenza di un attributo API come prova di un’esclusione', () => {
    const reducedCatalogVenue = runtimeGoldVenue({
      id: 'reduced-catalog-live',
      catalogApiRankingEvidence: {
        source: 'catalog-api',
        qualityScore: 90,
        generatedAt: runtimeReferenceDate.toISOString(),
        travelDisclosure: 'stimata, non routing',
      },
      features: [],
      atmosphere: [],
      occasions: [],
      semanticTags: ['ambiente senza musica', 'non pensato per aperitivo'],
    });
    expect(rankVenues('senza musica', undefined, [reducedCatalogVenue], {}, undefined, runtimeReferenceDate)).toEqual([]);
    expect(rankVenues('evita aperitivo', undefined, [reducedCatalogVenue], {}, undefined, runtimeReferenceDate)).toEqual([]);
  });

  it('estrae il numero di persone ma resta fail-closed senza capienza verificata', () => {
    const explicit = parseIntent('aperitivo elegante per 8 persone');
    const conversational = parseIntent('siamo in 12 e cerchiamo un rooftop');
    const conversationalWords = parseIntent('siamo in quattro e cerchiamo un rooftop');
    expect(explicit.partySize).toBe(8);
    expect(conversational.partySize).toBe(12);
    expect(conversationalWords.partySize).toBe(4);
    expect(explicit.unsupportedConstraints).toContainEqual({
      code: 'PARTY_SIZE',
      label: 'capienza verificata per 8 persone',
    });
    expect(rankVenues(explicit.query)).toEqual([]);
    expect(parseIntent('tavoli grandi').unsupportedConstraints.map(({ code }) => code)).toContain('PARTY_SIZE');
    expect(parseIntent('aperitivo elegante per 100 persone').unsupportedConstraints.map(({ code }) => code)).toContain('PARTY_SIZE');
    expect(parseIntent('siamo in 120 e cerchiamo un rooftop').unsupportedConstraints.map(({ code }) => code)).toContain('PARTY_SIZE');
    expect(conversationalWords.unsupportedConstraints.map(({ code }) => code)).toContain('PARTY_SIZE');
    expect(rankVenues('aperitivo elegante per 100 persone')).toEqual([]);
  });

  it('distingue servizi e dieta verificabili dalle richieste non rappresentabili', () => {
    expect(parseIntent('deve avere wifi').requiredConcepts).toContain('wifi');
    expect(parseIntent('preferibilmente pet friendly con parcheggio').concepts)
      .toEqual(expect.arrayContaining(['pet friendly', 'parcheggio']));
    expect(parseIntent('ristorante halal').unsupportedConstraints.map(({ code }) => code))
      .toContain('UNVERIFIED_DIETARY_OPTION');
    expect(parseIntent('locale con area bambini').unsupportedConstraints.map(({ code }) => code))
      .toContain('UNVERIFIED_SERVICE');
    expect(rankVenues('deve avere wifi').every((venue) => (
      [...venue.features, ...(venue.semanticTags ?? [])].some((value) => /wifi/i.test(value))
    ))).toBe(true);
  });

  it('tratta mood obbligatori come vincoli e non come semplice scoring', () => {
    const quiet = rankVenues('deve essere tranquillo');
    const intimate = rankVenues('solo intimo');
    expect(quiet.length).toBeGreaterThan(0);
    expect(intimate.length).toBeGreaterThan(0);
    expect(quiet.every((venue) => venue.atmosphere.includes('tranquillo'))).toBe(true);
    expect(intimate.every((venue) => venue.atmosphere.includes('intimo'))).toBe(true);
  });

  it('non ammette mai una venue non Gold-eligible', () => {
    const ineligible: Venue = { ...venues[0], id: 'not-gold', recommendationEligible: false };
    const results = rankVenues('cocktail bar', undefined, [ineligible, ...venues]);
    expect(results.some((venue) => venue.id === 'not-gold')).toBe(false);
  });

  it('applica al runtime Gold confidence minima e freshness/provenance correnti', () => {
    const valid = runtimeGoldVenue();
    const staleOpenStatus = runtimeGoldVenue({
      openStatus: {
        ...valid.openStatus,
        checkedAt: '2026-07-01T18:00:00+02:00',
        validUntil: '2026-07-02T02:00:00+02:00',
      },
    });
    const staleFieldProvenance = runtimeGoldVenue({
      provenance: {
        ...valid.provenance,
        attributes: {
          ...valid.provenance.attributes,
          checkedAt: '2025-01-01T00:00:00+01:00',
          validUntil: '2025-02-01T00:00:00+01:00',
        },
      },
    });

    expect(rankVenues('', undefined, [valid], {}, undefined, runtimeReferenceDate).map(({ id }) => id))
      .toEqual([valid.id]);
    expect(rankVenues('', undefined, [runtimeGoldVenue({ confidence: 0.69 })], {}, undefined, runtimeReferenceDate))
      .toHaveLength(0);
    expect(rankVenues('', undefined, [runtimeGoldVenue({ verifiedAt: '2026-01-01' })], {}, undefined, runtimeReferenceDate))
      .toHaveLength(0);
    expect(rankVenues('', undefined, [staleOpenStatus], {}, undefined, runtimeReferenceDate)).toHaveLength(0);
    expect(rankVenues('', undefined, [staleFieldProvenance], {}, undefined, runtimeReferenceDate)).toHaveLength(0);
  });

  it('preserva la fixture dichiarata nel ranking di anteprima', () => {
    const farFuture = new Date('2030-01-01T12:00:00+01:00');
    expect(rankVenues('', undefined, [venues[0]], {}, undefined, farFuture).map(({ id }) => id))
      .toEqual([venues[0].id]);
  });
});

describe('retrieval, override e spiegabilità', () => {
  it('distingue gli attributi strutturati dalla somiglianza semantica editoriale', () => {
    const [result] = rankVenues('vista Duomo al tramonto per un ospite da fuori');
    expect(result.id).toBe('quota-ventuno');
    expect(result.matchedConcepts).toContain('vista Duomo');
    expect(result.matchedConcepts).not.toContain('tramonto');
    expect(result.reasonCodes).toContain('FEATURE_MATCH');
    expect(result.reasonCodes).toContain('SEMANTIC_MATCH');
  });

  it('un override UI del quartiere sostituisce la località nella query', () => {
    const [result] = rankVenues('cocktail a Brera', undefined, venues, { neighborhood: 'Moscova' });
    expect(result.id).toBe('ombra-moscova');
    expect(result.reasonCodes).toContain('NEIGHBORHOOD_MATCH');
  });

  it('riconosce budget con soglia posposta e formule colloquiali', () => {
    expect(parseIntent('cena 40 euro massimo').maxSpend).toBe(40);
    expect(parseIntent('cena non oltre 40 euro').maxSpend).toBe(40);
    expect(parseIntent('cena fino a 40 euro').maxSpend).toBe(40);
    expect(parseIntent('cena senza spendere più di 40 euro').maxSpend).toBe(40);
    expect(parseIntent('cena budget 40').maxSpend).toBe(40);
    const results = rankVenues('aperitivo 40 euro massimo');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((venue) => venue.averageSpend <= 40)).toBe(true);
  });

  it('mantiene specifica una vista richiesta come must-have', () => {
    const intent = parseIntent('deve avere vista Duomo');
    const results = rankVenues(intent.query);
    expect(intent.requiredConcepts).toContain('vista Duomo');
    expect(results.map((venue) => venue.id)).toEqual(['quota-ventuno']);
  });

  it('un override UI del quartiere sostituisce anche requisiti ed esclusioni testuali', () => {
    const moscova = rankVenues('solo in Brera', undefined, venues, { neighborhood: 'Moscova' });
    const brera = rankVenues('aperitivo non a Brera', undefined, venues, { neighborhood: 'Brera' });
    expect(moscova.length).toBeGreaterThan(0);
    expect(brera.length).toBeGreaterThan(0);
    expect(moscova.every((venue) => venue.neighborhood === 'Moscova')).toBe(true);
    expect(brera.every((venue) => venue.neighborhood === 'Brera')).toBe(true);
  });

  it('restituisce ruoli distinti e reason code leggibili', () => {
    const results = rankVenues('aperitivo elegante');
    expect(results.map((item) => item.role)).toEqual(['best-fit', 'safe-alternative', 'smart-wildcard']);
    expect(results.every((item) => item.reason.length > 20)).toBe(true);
    expect(results[0].reasonCodes).toContain('GOLD_ELIGIBLE');
    expect(results[1].reasonCodes).toContain('DIVERSITY_ALTERNATIVE');
    expect(results[2].reasonCodes).toContain('CONTROLLED_WILDCARD');
    expect(results[1].divergenceDimensions).toEqual([]);
    expect(results[2].divergenceDimensions).toHaveLength(1);
    expect(results[2].tradeoff).toContain(results[2].divergenceDimensions[0]);
  });

  it('espone tre motivazioni leggibili e direttamente derivate dai segnali', () => {
    const [result] = rankVenues('aperitivo elegante');
    const explanation = result.reason.replace(/^[^:]+:\s*/, '').replace(/\.$/, '');
    const reasons = explanation.split('; ');

    expect(reasons).toHaveLength(3);
    expect(reasons).toEqual(expect.arrayContaining([
      'pensato per aperitivo',
      'atmosfera elegante',
      `${result.travelEstimate.minutes} minuti da ${result.travelEstimate.origin.shortLabel}`,
    ]));
  });

  it('completa il podio con una terza alternativa rilevante quando non esiste una wildcard sicura', () => {
    const results = rankVenues('budget 100');

    expect(results).toHaveLength(3);
    expect(results.map(({ role }) => role)).toEqual(['best-fit', 'safe-alternative', 'safe-alternative']);
    expect(results[2].reasonCodes).toContain('DIVERSITY_ALTERNATIVE');
    expect(results[2].reasonCodes).not.toContain('CONTROLLED_WILDCARD');
    expect(results[2].divergenceDimensions).toEqual([]);
    expect(results[2].tradeoff).toContain('nessuna deviazione wildcard applicata');
  });

  it('espone il vincolo temporale e la provenienza nella spiegazione', () => {
    const now = rankVenues('aperto ora');
    const tonight = rankVenues('aperitivo stasera', undefined, venues, {}, undefined, new Date('2026-07-16T12:00:00+02:00'));
    expect(now.length).toBeGreaterThan(0);
    expect(tonight.length).toBeGreaterThan(0);
    expect(now[0].reason).toContain('aperto ora');
    expect(now[0].reason).toContain('dimostrativo');
    expect(tonight[0].reason).toContain('orari dimostrativi');
  });

  it('produce un ordinamento stabile anche a parità di punteggio', () => {
    const twins: Venue[] = [
      { ...venues[0], id: 'zeta', slug: 'zeta', neighborhood: 'Navigli' },
      { ...venues[0], id: 'alfa', slug: 'alfa' },
    ];
    expect(rankVenues('', undefined, twins).map((venue) => venue.id)).toEqual(['alfa', 'zeta']);
  });

  it('non completa il podio con candidati privi di evidenza sufficiente', () => {
    expect(rankVenues('brunch laptop').map((venue) => venue.id)).toEqual(['dispensa-isola']);
    expect(rankVenues('vino naturale').map((venue) => venue.id)).toEqual(['corte-naviglio']);
    expect(rankVenues('vista Duomo').map((venue) => venue.id)).toEqual(['quota-ventuno']);
  });

  it('restituisce uno stato vuoto quando il catalogo non ha evidenza per la richiesta', () => {
    expect(rankVenues('karaoke')).toHaveLength(0);
    expect(rankVenues('pizzeria napoletana')).toHaveLength(0);
    expect(rankVenues('sushi omakase')).toHaveLength(0);
    expect(rankVenues('con parcheggio')).toHaveLength(0);
    expect(rankVenues('locale per bambini')).toHaveLength(0);
    expect(rankVenues('tavoli grandi')).toHaveLength(0);
  });

  it('non scarta query composte soltanto da vincoli duri validi', () => {
    const budget = rankVenues('budget 40');
    const spend = rankVenues('senza spendere più di 40 euro');
    const noMusic = rankVenues('non vorrei musica');
    const notBrera = rankVenues('non mi interessa Brera');

    expect(budget.length).toBeGreaterThan(0);
    expect(spend.length).toBeGreaterThan(0);
    expect(noMusic.length).toBeGreaterThan(0);
    expect(notBrera.length).toBeGreaterThan(0);
    expect(budget.every((venue) => venue.averageSpend <= 40)).toBe(true);
    expect(spend.every((venue) => venue.averageSpend <= 40)).toBe(true);
    expect(noMusic.every((venue) => !venue.features.includes('musica'))).toBe(true);
    expect(notBrera.every((venue) => venue.neighborhood !== 'Brera')).toBe(true);
  });
});

describe('profilo di gusto locale', () => {
  const rooftopProfile: TasteProfile = {
    ...createEmptyTasteProfile(),
    preferences: { atmosphere: 4, energy: 4, budget: 3 },
    interests: ['Rooftop', 'Vista Duomo'],
  };

  it('applica il profilo soltanto come segnale debole e spiegabile', () => {
    const results = rankVenues('', undefined, venues, {}, rooftopProfile);
    const rooftop = results.find((venue) => venue.id === 'quota-ventuno');

    expect(rooftop?.reasonCodes).toContain('PROFILE_MATCH');
    expect(rooftop?.profileMatches).toEqual(expect.arrayContaining(['Rooftop', 'Vista Duomo']));
  });

  it('non permette al profilo di superare un hard constraint', () => {
    const results = rankVenues('solo un cocktail bar', undefined, venues, {}, rooftopProfile);
    const intent = parseIntent('solo un cocktail bar');

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((venue) => venue.category === 'Cocktail bar')).toBe(true);
    expect(results.every((venue) => respectsHardConstraints(venue, intent))).toBe(true);
  });

  it('ignora completamente un profilo sospeso', () => {
    const suspendedProfile: TasteProfile = { ...rooftopProfile, state: 'suspended' };
    const baseline = rankVenues('', undefined, venues);
    const suspended = rankVenues('', undefined, venues, {}, suspendedProfile);

    expect(suspended.map(({ id, score }) => ({ id, score }))).toEqual(
      baseline.map(({ id, score }) => ({ id, score })),
    );
    expect(suspended.every((venue) => !venue.reasonCodes.includes('PROFILE_MATCH'))).toBe(true);
    expect(suspended.every((venue) => venue.profileMatches.length === 0)).toBe(true);
  });
});
