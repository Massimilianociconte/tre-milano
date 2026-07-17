# TRE Milano — SEO/GEO production readiness

Versione 0.1 — 16 luglio 2026  
Stato complessivo: **DONE_WITH_CONCERNS**. Struttura tecnica pronta; entity, catalogo, fonti e legal approval bloccano l’indicizzazione.

## 1. Regola di pubblicazione

Una URL è indicizzabile soltanto se tutte le condizioni sono vere:

1. `PUBLIC_SITE_MODE=production`;
2. `PUBLIC_DATA_MODE=gold`;
3. `PUBLIC_SITE_URL` è HTTPS pubblico e definitivo;
4. la route è `ready` nel manifest;
5. il contenuto reale supera maturity/provenance/media gates;
6. title, description, H1, canonical, breadcrumb e structured data corrispondono al contenuto visibile;
7. autore/revisore, fonti, date e stato sono reali;
8. legal/privacy review è approvata per le funzioni presenti.

La preview deve restare `Disallow: /`, `noindex, follow`, senza sitemap pubblica. Una variabile non può rendere Gold dati fixture.

## 2. Stato delle superfici trust

| Superficie | Valore SEO/GEO | Stato |
| --- | --- | --- |
| Metodologia | risposta breve, criteri, FAQ, riferimenti tecnici | template pronto; verificare owner reale |
| Fonti | provenance per campo, licenze, freshness, FAQ | `draft/noindex` finché non esistono fonti reali |
| Redazione | responsabilità, review, conflitti | `draft/noindex`; nomi e credenziali mancanti |
| Privacy/cookie/termini | trasparenza e user trust | `draft/noindex`; placeholder e legal approval mancanti |
| Correzioni/claim | feedback, takedown, data quality | Netlify Forms attivi in preview; API Supabase/Turnstile predisposta ma non collegata; moderazione e SLA mancanti |
| Catalogo API | ricerca/filtri/geo e provenance | schema e Functions versionati, fail-closed; nessun progetto remoto o dato Gold |

Le pagine legali non sono contenuti da usare come riempitivo SEO. Entrano in sitemap solo se definitive e utili; moduli, conferme e account restano normalmente `noindex`.

## 3. Entity e CORE-EEAT

Manca un profilo canonico verificato di TRE Milano. Prima dell’indicizzazione servono:

- denominazione legale, sede, contatti e URL definitivi coerenti;
- responsabile editoriale, autori/revisori, biografie e competenze verificabili;
- policy conflitti, correzioni e contenuti sponsorizzati;
- `Organization`/`Person` schema corrispondente alle informazioni visibili;
- link `sameAs` solo verso profili ufficiali;
- contatti privacy, reclami e titolari reali.

Non usare Organization schema con placeholder o credenziali non visibili. La mancanza di entity reale è un blocco, non un dettaglio da compensare con più JSON-LD.

## 4. Requisiti delle pagine locali

Ogni venue, quartiere, categoria o guida indicizzabile deve avere:

- intento e risposta principale immediati, senza testo generico;
- contenuto originale basato su osservazioni/fonti reali;
- dati critici con data e provenienza;
- stato aperto/chiuso, freschezza e limiti dichiarati;
- immagini con diritti, dimensioni, alt e formati responsive;
- link a hub, quartiere, categoria, guida, metodologia, fonti e correzione;
- breadcrumb visibile e `BreadcrumbList` coerente;
- `LocalBusiness` solo per schede Gold con tipo, identità e dati validi;
- FAQ schema soltanto per domande/risposte visibili e non promozionali;
- canonical pulito; combinazioni filtro/query `noindex` salvo landing editoriale dedicata.

Le pagine thin, duplicate o generate da combinazioni non verificate restano fuori dal manifest.

## 5. Citation readiness / GEO

Pattern adottato per le trust page:

- answer block autonomo di 25–50 parole;
- sezioni atomiche con titoli descrittivi;
- distinzione tra fatto, stima, policy proposta e dato mancante;
- link a fonti primarie/ufficiali vicino alle affermazioni;
- data di controllo e stato editoriale;
- FAQ che rispondono a query reali, con testo visibile uguale allo schema;
- nessun claim assoluto su accuratezza, licenza, privacy o ranking.

Query AI target coperte dal pacchetto trust:

| Query | Blocco citabile |
| --- | --- |
| Come verifica i locali TRE Milano? | `/fonti/` — provenance per campo e ordine fonti |
| Un locale può comprare il podio? | `/metodologia/` e `/redazione/` — indipendenza commerciale |
| Come correggere o rimuovere una scheda? | `/correzioni/` e `/rivendica-scheda/` |
| TRE Milano salva la posizione? | `/privacy/` — geolocalizzazione foreground volatile |
| Quali cookie usa TRE Milano? | `/cookie-policy/` — inventario tecnico |
| DeepSeek sceglie i locali? | `/privacy/` e `/metodologia/` — interprete separato dal ranker |

## 6. Crawler e discovery

- Google/Bing e crawler AI non ricevono accessi speciali a contenuti privati o query.
- `robots.txt` è un segnale di crawl, non un controllo di accesso.
- `OAI-SearchBot`, `ChatGPT-User` e `GPTBot` hanno ruoli distinti; la policy deve essere intenzionale.
- Sitemap segmentate includono solo route `ready` e lastmod editoriale reale.
- IndexNow è dry-run per default e non deve notificare bozze o fixture.
- `llms.txt` non sostituisce crawlability, contenuto utile, provenance o structured data.

## 7. Ricerca e privacy SEO

- Le query ordinarie passano tramite `sessionStorage`, non nell’URL.
- Il link condiviso può contenere `q`; canonical resta sulla route pulita e la pagina di ricerca è `noindex`.
- L’interprete semantico e il claim API usano `no-store`; le query non devono apparire in log applicativi o analytics. Le API catalogo possono usare cache CDN breve solo per richieste non personali: query libere e coordinate precise richiedono una policy dedicata prima del collegamento frontend.
- DeepSeek non riceve catalogo o posizione ed è tecnicamente attivo nella preview `noindex`; il trasferimento dell’input resta un gate privacy da chiudere prima di promozione e indicizzazione.
- Le API catalogo sono collegate al frontend; le coordinate foreground restano in memoria nel browser e non vengono inviate a DeepSeek. Cache e log URL/CDN sono minimizzati per le richieste sensibili e l’informativa descrive il flusso attuale.
- Il rate limit database usa identificatori pseudonimizzati e a breve scadenza; un hash resta dato personale pseudonimo quando può essere collegato al contesto operativo.

## 8. Misure e score

| Indicatore | Valore | Tipo |
| --- | --- | --- |
| Trust/legal page create o riscritte | 8 superfici | Measured (repository) |
| Flussi Netlify Forms pubblici | 2 (`correzione`, `rivendicazione`) | Measured (repository) |
| Legal/trust route esplicitamente `draft/noindex` | 7 nel manifest + redazione/fonti esplicite | Measured (repository) |
| Canonical entity profile completo | assente | Measured (repository) |
| Fonti reali importate/licenziate | 0 dichiarate; source registry disabilitato e fixture demo | Measured (repository) |
| GEO readiness trust content, prima | 38/100 | Estimated (struttura esistente, claim e legal incompleti) |
| GEO readiness trust content, dopo | 78/100 | Estimated (answer blocks, fonti, FAQ, status e linking); bloccato da entity/catalogo reali |
| AI Query Coverage per 6 query trust target | 6/6 con blocco dedicato | Estimated (content mapping, non misurazione SERP) |

Nessun punteggio stimato va presentato come traffico, ranking o citazione misurata.

## 9. CORE-EEAT GEO self-check

| Controllo | Esito | Evidenza/azione |
| --- | --- | --- |
| C02 accuratezza e claim verificabili | Pass | claim limitati e stato bozza visibile |
| C04 utilità sopra la piega | Pass | answer block in ogni pagina |
| C09 fonti | Pass con concern | fonti ufficiali; fonti venue reali mancanti |
| O02 struttura | Pass | H1/H2, FAQ e related links |
| O03 identità responsabile | Fail aperto | titolare e redazione nominativi mancanti |
| O05 date/stato | Pass | data e status visibili; serve workflow reale |
| O06 correzioni | Pass con concern | due form; backend moderazione/SLA mancanti |
| R01/R02 crawl e canonical | Pass in preview | noindex fail-closed; dominio finale da testare |
| R04 structured data | Warn | template presente; Organization reale mancante |
| R07 internal linking | Pass | trust graph bidirezionale nelle nuove pagine |
| E01 evidenza primaria | Warn | normativa ufficiale sì; osservazioni venue no |
| Exp10 esperienza reale | Fail aperto | guide/catalogo demo |
| Ept08 credenziali | Fail aperto | autori/revisori da nominare |

## 10. Checklist prima dell’indicizzazione

- [ ] dominio definitivo, Search Console e Bing verificati;
- [ ] catalogo reale Gold con fonte/licenza per campo;
- [ ] entity e redazione reali;
- [ ] legal approval e provider register;
- [ ] DeepSeek approvato o mantenuto disattivato;
- [ ] immagini con asset ledger;
- [ ] guide originali e review umana;
- [ ] audit canonical/noindex/sitemap su dominio reale;
- [ ] Rich Results Test sui tipi effettivamente idonei;
- [ ] crawl completo senza thin/duplicate/faceted indexation;
- [ ] Core Web Vitals e rendering mobile su dati reali;
- [ ] monitoraggio errori, query gap e freshness;
- [ ] procedura di correzione/claim testata end-to-end.

## 11. Fonti tecniche primarie

- [Google Search — optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Google Search — spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google Search — structured data guidelines](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- [Schema.org LocalBusiness](https://schema.org/LocalBusiness)
- [Bing — IndexNow](https://www.indexnow.org/documentation)
- [OpenAI — crawler and user-agent documentation](https://developers.openai.com/api/docs/bots)

## 12. Content quality gate sulle superfici trust/legal

**Verdetto: FIX prima della pubblicazione definitiva.** Il contenuto è sostanziale, coerente e correttamente dichiarato come bozza; non emergono titoli ingannevoli, contraddizioni o disclosure mancanti. Mancano però identità/contatti reali, approvazione legale e prova operativa dei processi di retention e moderazione.

Assunzione di audit: bundle informativo/policy, pesi uguali fra le dimensioni osservabili. La dimensione Authority è esclusa perché più della metà dei segnali richiede dati esterni non disponibili (backlink, media, award, recognition, knowledge graph e community standing).

| Area | Controlli (10 per area) | Punteggio |
| --- | --- | --- |
| Chiarezza | intent alignment 10; direct answer 10; query coverage 10; definition first 10; scope 10; audience 10; coherence 10; use cases 10; FAQ 10; closure 10 | 100/100 |
| Organizzazione | hierarchy 10; summary 10; tables 10; lists 10; schema 10; chunking 10; hierarchy visuale 10; anchor navigation 10; density 10; multimedia structure 5 | 95/100 |
| Referenziabilità | precision 10; citation density 10; source hierarchy 10; claim mapping 10; methodology 10; versioning 10; entity precision 0; internal links 10; semantics 10; consistency 10 | 90/100 |
| Esclusività | original evidence 10; framework 10; repo research 10; contrarian value 5; proprietary visual 10; gap filling 10; practical tools 10; depth 10; synthesis 10; forward insight 10 | 95/100 |
| Esperienza | first-person N/A; sensory detail N/A; process 10; tangible proof 10; duration 5; problems 10; before/after 5; metrics 10; repeated testing 10; limitations 10 | 87/100 |
| Competenza | author identity 0; credentials 0; vocabulary 10; depth 10; rigor 10; edge cases 10; history 5; reasoning 10; cross-domain 10; editorial process 10 | 75/100 |
| Autorità | backlink N/A; media N/A; award N/A; publishing record N/A; recognition N/A; social proof N/A; knowledge graph N/A; entity consistency 0; partnership N/A; community N/A | dati insufficienti |
| Fiducia | legal readiness 5; contact transparency 0; security 10; disclosure 10; editorial policy 10; corrections 10; advertising experience 10; disclaimers 10; review authenticity 10; support 5 | 80/100 |

- **Qualità contenutistica complessiva:** 88/100, stimata sul repository e non equivalente a ranking o traffico.
- **GEO/content structure:** 95/100, stimata sui quattro assi contenutistici.
- **SEO/credibility osservabile:** 80/100, stimata escludendo Authority per insufficienza di dati.
- **Critical trust check:** nessun override; bozza e limiti sono dichiarati in modo visibile.

Priorità di miglioramento:

1. sostituire titolare, contatti, autori e credenziali con dati verificati;
2. approvare basi giuridiche, retention e trasferimenti con il legale;
3. provare cancellazione Netlify Forms e workflow di moderazione end-to-end;
4. riallineare le informative al contratto Supabase/PostGIS definitivo prima dell’attivazione;
5. determinare l’applicabilità DSA e gli SLA interni di notice/action e reclamo.
6. creare il progetto Supabase UE, applicare le migrazioni, provare backup/restore e verificare il cutover senza fixture;
7. collegare Turnstile e claim API soltanto dopo DPA/privacy review, mantenendo Forms come flusso effettivo fino ad allora.
