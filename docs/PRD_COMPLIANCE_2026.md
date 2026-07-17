# TRE Milano — matrice di conformità PRD 2026

Fonti di governo:

- `TRE_Milano_Strategia_Rivista_SEO_GEO_2026.pdf`
- `TRE_Milano_Blueprint_Esecutivo_2026.pdf`
- concept visuali del 16 luglio 2026, con priorità a `(2).png` per desktop e `(3).png` per mobile/podio.

## UI e fedeltà visuale

| Requisito | Stato | Implementazione |
| --- | --- | --- |
| Podio sempre leggibile come insieme | Completo | Griglia fissa `2–1–3`, senza carousel mobile. |
| Gerarchia del primo posto | Completo | Colonna centrale circa 20% più larga e card circa 25% più alta; basi allineate. |
| Sagoma del concept | Completo | `clipPath` SVG normalizzato con spalle, cupola centrale, medaglione e bordo champagne. |
| Densità delle card | Completo | Nome, categoria/zona, fascia prezzo, minuti, chip e bookmark; motivazione in disclosure separata. |
| Mobile first fold | Completo | Hero visivamente omesso ma H1 conservato nell’albero accessibile; ricerca, contesto e podio subito nel first fold. |
| Desktop | Completo | Risultati/mappa vicini al rapporto 58/42 del concept e card più compatte. |
| Azioni del podio | Completo | Salvataggio locale, condivisione nativa/copia link, ricalcolo senza una scelta e trade-off visibile nel disclosure. |
| Azioni venue passport | Completo nel codice, Gold data-gated | Condividi è sempre disponibile; Sito, Menu, Prenota, Chiama e Naviga richiedono valore coerente, provenance fresca e pubblicabilità. Le fixture non mostrano CTA operative. |
| Accessibilità card | Completo | Posizione annunciata, target da 44 px, Escape/chiusura con ritorno focus, tipografia leggibile e navigazioni con nomi distinti. |
| Funzioni non disponibili | Intenzionale | Nessuna falsa prenotazione o notifica: Prenota appare soltanto con un URL operativo verificato; in assenza del dato la CTA non viene renderizzata. |

## Ricerca e ranking

| Requisito | Stato | Implementazione |
| --- | --- | --- |
| Retrieval locale-first e deterministico | Completo | Le query già coperte restano locali; quelle complesse possono usare DeepSeek come interprete tassonomico. Il modello non vede il catalogo e il ranking resta deterministico con fallback. |
| Linguaggio naturale | Completo | Accenti, apostrofi, sinonimi, categorie, quartieri, mood, occasioni, feature, budget colloquiali e tempi a piedi. |
| Intenti multipli | Completo | Conservati in ordine di menzione e pesati separatamente. |
| Vincoli duri | Completo | Fasce budget, tempo da origine dichiarata, apertura adesso, orario/giorno, esclusioni, `solo` e `deve avere` prima dello scoring. |
| Negazioni e modalità | Completo | Clausole, liste coordinate, AND/OR e formule “non necessariamente” non perdono o inventano vincoli. |
| Safety | Completo nel fallback | Allergeni/diete e accessibilità non verificati restituiscono stato vuoto invece di essere indovinati. |
| Podio differenziato | Completo | #2 conserva la firma di preferenza; #3 usa una wildcard solo con una deviazione non dura sicura, altrimenti completa il podio con una normale alternativa rilevante e lo dichiara nel ruolo/trade-off. |
| Spiegabilità | Completo | Tre motivazioni deduplicate e derivate dai dati, `reasonCodes`, concetti, provenance temporale, profilo applicato e trade-off deterministici. |
| Configurazione versionata | Completo | Pesi, soglie e `RANKING_VERSION` sono centralizzati in `src/ranking/config.ts`; il golden runner fallisce in caso di divergenza dataset/runtime. |
| Profilo di gusto | Completo locale | Segnale debole, esplicito, sospendibile/esportabile/cancellabile; non supera mai i vincoli e viene salvato sincronicamente. |
| Continuità offline | Completo nel service worker | `/cerca/` è una shell precache; una query offline riceve quella shell senza diventare una chiave di cache. API e altre URL con parametri restano network-only; in preview il worker non viene registrato. |
| Contratto analytics | Completo locale, non strumentato | Tassonomia v1, privacy class, envelope con correlation/idempotency e proprietà in allowlist; il dispatcher usa soltanto `CustomEvent`, senza rete, cookie o storage. La raccolta remota resta intenzionalmente assente. |
| Valutazione | Baseline fixture completa | Golden set v1 da 30 query, gate 0% hard violation / 95% podi accettabili (almeno 2/3, oppure tutte le card se il podio annotato ne supporta meno) / 80% Top1 / 98% explanation e p95; diversità, utilità wildcard e fallback normale restano diagnostiche non-gate. Il Gold set di lancio resta esterno. |

## SEO, GEO e indicizzazione

| Requisito | Stato | Implementazione |
| --- | --- | --- |
| Indicizzazione selettiva | Completo | Manifest per URL con stati `draft`/`ready`; default sicuro `noindex`. |
| Anti-fixture/maturity gate | Completo | Un unico contratto usato da validatore e ranking gestisce Bronze/Silver come `explore-only`, ammette al podio soltanto Gold/Platinum e blocca fixture in production, confidence sotto 0,70, core field invalidi, fonti riservate, dati stantii, provenance campo per campo, diritti media, geo fuori Milano, travel origin e collection incomplete; la fixture dichiarata resta attiva solo in preview e non è mai pubblicabile. |
| Gate azioni operative | Completo | Ogni CTA del venue passport ha provenance separata, HTTPS pubblico, freschezza massima 90 giorni e coerenza con telefono/geo/URL publication. Naviga invia al provider solo la destinazione verificata. |
| Sitemap | Completo | Segmentate per tipologia, solo URL `ready`, con `lastmod` editoriale dichiarato. |
| Meta e canonical | Completo | Canonical senza query, title/description, Open Graph e Twitter completi. |
| Dati strutturati | Completo nel codice | Grafo Organization/WebSite/SearchAction, Article, BreadcrumbList e FAQ visibile; LocalBusiness solo Gold con `schemaType` verificato. |
| Entity e responsabilità | Template completo, Gold bloccato | Redazione, autore/revisore, date, stato e trust graph esistono; servono nomi/credenziali reali prima dell’indicizzazione. |
| Citation readiness | Template completo, contenuti Gold bloccati | Risposta breve, sezioni atomiche, FAQ e date esistono; le guide richiedono osservazioni e citazioni editoriali reali. |
| Crawler AI | Completo | OAI-SearchBot e ChatGPT-User separati da GPTBot; nessuna promessa basata su `llms.txt`. |
| IndexNow | Completo | File ownership opzionale, dry run predefinito, invio esplicito e sole URL `ready`. |
| Internal linking | Completo | Hub, quartieri, categorie, guide, trust page e venue template collegati; audit link automatico. |
| Legal e privacy surface | Bozze complete, approvazione bloccata | Privacy, Cookie Policy, Termini, informativa moduli, correzioni e claim distinguono flusso Netlify Forms attivo e backend Supabase/Turnstile predisposto; tutto resta `noindex` finché titolare, DPA/TIA, retention e revisione legale non sono approvati. |
| Claim e rimozione scheda | Preview manuale completa; API predisposta, non collegata | Form Netlify separato dalle correzioni, verifica di ruolo senza upload e nessun effetto automatico su dati o ranking. L’API claim Supabase/Turnstile è fail-closed e richiede progetto remoto, widget, DPA, moderazione, SLA e cancellazione prima del cutover. |

## Verifiche automatiche

- Suite Vitest completa su semantica, vincoli, negazioni, ranking, provenance, persistenza, collection, indicizzazione e golden evaluation.
- Astro check sull'intero progetto senza errori, warning o hint.
- Catalogo fixture validato a 20 schede: 6 Gold/Platinum per la baseline di raccomandazione e 14 Bronze/Silver `explore-only`, tutte `noindex` e non pubblicabili.
- Audit post-build su H1, `lang`, canonical, robots, JSON-LD XSS-safe, immagini/asset, ID duplicati, link interni, manifest/sitemap e PWA, incluso il fallback offline privacy-safe della shell di ricerca.
- Golden evaluation fixture v1: 0% hard violation, 100% podi accettabili con il nuovo contratto 2/3, 100% Top1, 100% explanation support; p95 entro i budget, con misure correnti versionate in `reports/ranking/fixture-baseline-v1.*`.
- Preview: robots blocca tutto, ogni HTML è `noindex, follow`, sitemap assente.
- Test negativo: build, sitemap e invio IndexNow vengono rifiutati finché catalogo e collezioni non sono Gold.

## Dipendenze esterne ancora necessarie per il go-live

Queste attività non possono essere simulate nel repository e non vanno dichiarate completate:

1. catalogo reale Gold/Platinum con fonti effettive, identità, coordinate, orari, prezzi, attributi, routing e diritti media;
2. gold set di lancio annotato (almeno 200 query, review finale prevista a 300) e confronto pairwise prima di qualsiasi embedding;
3. profilo entity reale di TRE Milano, responsabili nominativi/credenziali e guide originali con osservazioni/citazioni;
4. almeno una collezione editoriale `published` composta da venue Gold validate;
5. dominio HTTPS definitivo e verifica del file IndexNow;
6. approvazione legale delle bozze privacy/cookie/termini, completamento del titolare, provider register, trasferimenti e retention;
7. applicazione delle migrazioni a un progetto Supabase UE, collegamento frontend/API, Turnstile, backend moderato per correzioni/claim, procedura notice-and-action e, se previsto, integrazione di prenotazione;
8. analytics/observability, query-gap, feedback aggregato e voto di gruppo con consenso e retention definiti;
9. QA sul dominio reale: Search Console, Bing Webmaster Tools, Rich Results, crawl, Core Web Vitals, browser e dispositivi fisici.

Il codice impedisce che la mancanza di questi elementi venga mascherata impostando soltanto variabili d’ambiente.
