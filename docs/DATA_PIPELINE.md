# Pipeline dati e fonti

La pipeline è conservativa: acquisizione non significa pubblicazione. Ogni nuovo locale nasce `draft/unverified/bronze`; soltanto un controllo editoriale può impostare stato, verifica, diritti media e pubblicazione. `private.refresh_venue_quality` calcola completezza/confidenza e abilita le raccomandazioni solo oltre i gate Gold.

## Fonti registrate

| Source key | Contenuto | Licenza | Volume grezzo | Limite determinante |
|---|---|---:|---:|---|
| `comune_milano_ds58` | Pubblici esercizi in piano | CC BY 4.0 | 9.417 | fotografia amministrativa al 31/12/2023 |
| `comune_milano_ds59` | Pubblici esercizi fuori piano | CC BY 4.0 | 3.671 | spesso manca un’insegna commerciale |
| `comune_milano_ds250` | Attività economiche alimentari | CC BY 4.0 | 1.594 | categoria amministrativa, non conferma apertura |
| `openstreetmap` | POI con tag e coordinate | ODbL 1.0 | variabile | endpoint condiviso non adatto a crawling massivo |
| `official_venue_facts` | sito/canali ufficiali | fatti verificati per campo | manuale | media e testi richiedono diritti separati |

Totale grezzo delle tre anagrafiche comunali: **14.682 osservazioni**. La migrazione `20260717092705_enable_milano_open_data_observations.sql` abilita le tre fonti comunali esclusivamente per l'acquisizione privata dopo averne registrato attribuzione, licenza e finalità. I record entrano in `source_observations`: non creano locali pubblici, non confermano automaticamente `lifecycle_status=active` e non alimentano il podio senza una revisione editoriale documentata.

Checkpoint remoto del 17 luglio 2026: **14.168 osservazioni accettate** e **2 errori conservati nel log**; i record grezzi che non superano normalizzazione o requisiti minimi non sono promossi a osservazioni utili. Il catalogo pubblico contiene **6 locali Gold/Platinum**, verificati tramite fonti ufficiali e procedura di revisione esplicita.

URL e attribuzioni sono versionati nella migrazione `20260716215043_catalog_ingestion_operations.sql`. Fonte: [portale Open Data Comune di Milano](https://dati.comune.milano.it/) e [licenza CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### Nucleo editoriale iniziale

I 6 locali pubblici sono verificati sui rispettivi canali ufficiali: [Camparino in Galleria](https://www.camparino.com/it/), [Nottingham Forest](https://www.nottingham-forest.com/), [Ceresio 7](https://www.ceresio7.com/milano/contatti/), [Ristorante Cracco](https://www.ristorantecracco.it/), [Mandarin Garden](https://www.mandarinoriental.com/it/milan/la-scala/dine/mandarin-garden) e [Armani/Bamboo Bar](https://www.armanihotels.com/it/hotels/armani-hotel-milano/dine/armani-bamboo-bar-it). Le coordinate conservano l'oggetto e l'attribuzione [OpenStreetMap](https://www.openstreetmap.org/copyright); la fonte OSM ha `api_url=null` e perciò è approvata soltanto per geocodifiche revisionate, non per crawling schedulato.

## Fasi

1. **Fetch**: HTTPS, redirect vietati, destinazione finale verificata, timeout esteso al body, massimo 32 MiB/50.000 feature e User-Agent identificabile.
2. **Normalize**: indirizzo, CAP, municipio, NIL, coordinate, contatti e categorie in un contratto JSON ristretto.
3. **Validate**: range Milano, enum/URL/telefono, source abilitata e licenza commerciale/derivativa approvata.
4. **Fingerprint**: SHA-256 di nome + indirizzo normalizzati; prima viene sempre cercato l’`external_id` della fonte.
5. **Dedupe**: match esatto automatico; nomi simili entro 100 m creano `duplicate_candidates`, senza merge automatico.
6. **Upsert conservativo**: una fonte automatica non sovrascrive campi verificati, non rinnova `stale_after` e non rende pubblico un prezzo non verificato; conserva provenance e history.
7. **Quality gate**: completezza, affidabilità delle sole fonti abilitate/correnti, freshness e diritti immagini.
8. **Review**: pubblicazione, chiusura/trasferimento e Gold restano decisioni umane verificabili.
9. **Incrementale**: checksum, `last_seen_at`, `expires_at`, source cursor, import counters/error log.
10. **Retention**: raw payload solo se i termini lo consentono; PII e rate-limit scaduti sono eliminati dal job giornaliero.

## Comandi

Dry-run e file NDJSON, senza scrivere:

```bash
pnpm data:milano -- --source=comune_milano_ds58 --output=/tmp/ds58.ndjson
```

Import di osservazioni amministrative, dopo aver abilitato esplicitamente la fonte nel DB:

```bash
DATA_IMPORT_DRY_RUN=false pnpm data:milano -- \
  --source=comune_milano_ds58 --apply --confirm-write
```

Import di record venue normalizzati e autorizzati:

```bash
DATA_IMPORT_DRY_RUN=false pnpm data:import -- \
  --source=official_venue_facts --file=/secure/venues.ndjson --confirm-write
```

Bootstrap ripetibile del nucleo editoriale incluso nel progetto, seguito dalla RPC di revisione manuale:

```bash
DATA_IMPORT_DRY_RUN=false pnpm data:bootstrap:official -- \
  --env=.env.netlify.local \
  --reviewer=tre-editorial-bootstrap-2026-07-17 \
  --confirm-write
```

Il dataset [`data/official-venue-facts.ndjson`](../data/official-venue-facts.ndjson) contiene soltanto fatti ricontrollati sui canali ufficiali e provenance OSM/Nominatim. La migrazione `20260717094502_register_owned_editorial_venue_visuals.sql` collega visual editoriali di proprietà del progetto, dichiarati esplicitamente illustrativi: non sono fotografie probatorie dei singoli locali.

Il writer usa batch da massimo 500 osservazioni. L’import NDJSON accetta al massimo 64 MiB, 50.000 record, 256 KiB per riga/payload, 50 contatti e 100 servizi; gli ultimi tre limiti sono ripetuti nel database sul confine privilegiato. `import_runs` e `import_errors` registrano contatori e errori; un run fallito non abilita record alla pubblicazione. L’endpoint Supabase della pipeline accetta HTTPS oppure HTTP esclusivamente su `localhost`, `127.0.0.1` o `::1` esatti: userinfo, path, query, fragment e host con prefissi ingannevoli sono rifiutati prima di inviare la chiave.

## Retry, obsolescenza e chiusure

- Retry massimo previsto: 5 tentativi, backoff e `next_retry_at` registrati nel run.
- Il maintenance giornaliero accoda fonti scadute, elimina retention scadute, deseleziona provenance scaduta/revocata, ricalcola i punteggi materializzati e toglie dalle raccomandazioni venue oltre `stale_after`.
- Il maintenance non sostituisce un worker di importazione: al momento gli aggiornamenti delle fonti ufficiali e comunali vengono avviati con i comandi documentati sopra; i run accodati restano visibili per un futuro worker schedulato.
- La scomparsa da una fonte non equivale a chiusura: si registra `deleted_at_source`, poi si confrontano fonte ufficiale e segnali indipendenti.
- `temporarily_closed`, `permanently_closed` e `moved` richiedono prova e audit trail.

## Revisione manuale minima

Prima di `active/verified/gold`: nome ufficiale, indirizzo/geocodifica, contatto ufficiale, orari freschi, fascia prezzo, fonte per ogni claim, immagine con licenza, controllo duplicati e data di prossima verifica. Le valutazioni devono indicare fonte, scala, conteggio, URL e data; non copiare testi delle recensioni.

## Pubblicazione esplorativa del catalogo amministrativo (17 luglio 2026)

La migrazione `20260717150000_explore_catalog_publication.sql` e lo script
`pnpm exec node scripts/data-promote-observations.mjs` promuovono le
osservazioni comunali in venue pubbliche **bronze/unverified explore-only**:

- dry-run per default; scrittura solo con `DATA_IMPORT_DRY_RUN=false` + `--confirm-write`;
- dedup per nome normalizzato + indirizzo/coordinate (priorità DS58 > DS59 > DS250) e guardia anti-duplicato contro i locali esistenti (fingerprint o stesso nome entro 150 m);
- mappatura delle categorie amministrative sulla tassonomia TRE (`caffe`, `ristorante`, `pasticceria`, `gelateria`, `enoteca`, `pub`, `club`, `hotel`, `altro`);
- insegne generiche ("PASTICCERIA", "BAR"…) escluse dalla promozione (`20260717153000`); i 124 record già promossi con nome generico sono stati riportati a draft;
- ogni scheda promossa dichiara fonte e data del dato ("anagrafica Comune di Milano, dati al 31/12/2023") nella descrizione e resta `recommendation_eligible=false`.

Esito finale del 17 luglio 2026: 7.531 venue promosse; 124 de-pubblicate per insegna generica e 5.743 per etichetta merceologica senza insegna reale (migrazione 20260717190000) → **1.664 schede bronze pubbliche con insegna reale** + 6 verificate Gold/Platinum.

Le API le espongono solo su richiesta esplicita: `GET /api/catalog?include_unverified=1`
(default invariato: solo verificate). Le schede runtime `/locale/?slug=…` servono anche
le bronze, marcate "Scheda importata · non verificata", con placeholder di categoria
come visual. Il podio e il ranking restano riservati a Gold/Platinum verificate:
l'adapter client scarta ogni record senza `verifiedAt`.

### Quartieri e revisione progressiva (17 luglio 2026, secondo round)

- `20260717170000_nil_neighborhood_backfill.sql`: le 22 zone editoriali sono ora
  tutte nel database con alias che coprono le etichette NIL comunali; backfill
  eseguito → 4.142 sedi con quartiere assegnato, 3.395 NIL periferici restano
  volutamente senza zona editoriale (il client mostra "Milano").
- `20260717173000_explore_review_workflow.sql` + `scripts/data-review-venue.mjs`:
  revisione umana bronze → silver (`verify-silver`, con correzioni opzionali di
  nome, categoria e quartiere) oppure `unpublish`. Ogni azione richiede un
  revisore dichiarato e viene tracciata in `venue_update_history`. La
  promozione Gold e l'idoneità al podio restano nel workflow editoriale
  ufficiale.
- Pagina pubblica `/esplora/`: browser del catalogo completo con filtri per
  testo, categoria e quartiere, badge "Verificato" / "Da verificare · fonte
  2023" e paginazione keyset via `/api/catalog?include_unverified=1`.
- Cost guard DeepSeek: cache in-memory per sessione di pagina delle
  interpretazioni (stessa query ⇒ una sola chiamata al provider), senza
  persistere il testo della query, in coerenza con la privacy policy.
