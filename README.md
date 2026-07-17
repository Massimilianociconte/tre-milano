# TRE Milano

Vertical slice PWA, content-first e SEO/GEO-ready costruita sui due PRD 2026 di TRE Milano. L’esperienza pubblica propone tre scelte motivate, applica prima i vincoli duri e mantiene trasparenti freschezza, confidenza e stato dei dati.

## Stato della consegna

- Homepage responsive aderente al sistema visivo navy, ivory e champagne gold.
- Ricerca semantica locale in italiano con sinonimi, accenti, occasioni, atmosfere, quartieri e concetti curati.
- Tassonomia quartieri unificata (`src/domain/neighborhoods.ts`): 22 zone con alias colloquiali (Montenapoleone, corso Como, Chinatown…) condivise da parser locale, contratto DeepSeek, snapshot del podio e selettore zona, incluse le zone del catalogo reale Porta Venezia, Monumentale e Quadrilatero della moda.
- Interprete remoto opzionale e privacy-first per le query davvero ambigue: DeepSeek traduce soltanto verso la tassonomia controllata, mentre selezione, vincoli e podio restano nel ranker locale. Vedi [`docs/SEARCH_INTERPRETER.md`](docs/SEARCH_INTERPRETER.md).
- Negazioni, esclusioni e requisiti espliciti (`solo`, `deve avere`) applicati come vincoli duri prima del ranking.
- Ranking deterministico con `Best Fit`, `Safe Alternative`, `Smart Wildcard`, tie-break stabile e diversità controllata.
- Reason code e concetti corrispondenti leggibili, stato vuoto affidabile e mappa contestuale.
- Preferiti persistenti soltanto nel browser, senza account o backend.
- Profilo di gusto locale, esplicito e cancellabile, applicato soltanto come segnale debole dopo i vincoli.
- Pagine statiche per city hub, quartiere, categoria, occasione, guida, metodologia, fonti, privacy e correzioni.
- Venti venue passport dimostrativi, `noindex` e senza schema `LocalBusiness`: sei fixture Gold/Platinum alimentano esclusivamente il podio demo, mentre quattordici Bronze/Silver sono dichiarate `explore-only`; il template pubblico usa soltanto un `schemaType` verificato.
- PWA con icone `any`/`maskable` separate: precache delle shell locali, inclusa `/cerca/`; quando la rete manca, una URL `/cerca/?…` riceve la shell neutra senza salvare il testo della query in Cache Storage. Le API restano network-only.
- Podio responsive 2–1–3 con sagoma a corona, medaglione, basi allineate e gerarchia fedele ai concept.
- Canonical, Open Graph/Twitter, JSON-LD a grafo, breadcrumb visibili, autore, revisore, FAQ visibili e pagine entity.
- Manifest di idoneità per singola URL, sitemap segmentate con `lastmod` dichiarato e audit automatico dei link interni.
- OAI-SearchBot e ChatGPT-User separati da GPTBot; IndexNow è disponibile solo per URL `ready` e invio esplicito.
- Golden evaluation versionata del ranking con gate hard/podio (almeno 2 risultati accettabili su 3)/Top1/spiegazioni/latency e report JSON/Markdown.
- Contratto analytics locale e privacy-first con tassonomia PRD versionata, envelope idempotente e solo `CustomEvent`: nessun trasporto, cookie o storage. Vedi [`docs/ANALYTICS_CONTRACT.md`](docs/ANALYTICS_CONTRACT.md).

I nomi e i dati dei locali sono fixture sintetiche. Non rappresentano attività reali e non devono essere pubblicati come catalogo operativo.

La copertura puntuale dei requisiti e i soli blocker esterni sono tracciati in [`docs/PRD_COMPLIANCE_2026.md`](docs/PRD_COMPLIANCE_2026.md).

## Avvio locale

Requisiti: Node.js 22.12 o successivo e pnpm 11.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
pnpm dev
```

Comandi di qualità:

```bash
pnpm test
pnpm eval:ranking
pnpm check
pnpm build
pnpm test:e2e
pnpm quality:lighthouse
pnpm quality:ci
pnpm preview
pnpm audit
pnpm media:generate
pnpm media:audit
```

La suite browser riproducibile, i budget e i limiti dichiarati sono descritti in [`docs/QUALITY_GATES.md`](docs/QUALITY_GATES.md).

### Bootstrap servizi collegati

Dopo aver compilato il file locale ignorato `.env.netlify.local`, sincronizzare l’allowlist verso il progetto Netlify già collegato con:

```bash
pnpm netlify:env:sync
```

Il comando non importa `SUPABASE_SERVICE_ROLE_KEY` né credenziali pipeline. Sul piano Netlify collegato le variabili non segrete restano all-scope; i valori riservati sono marcati `is_secret=true` e non ricevono lo scope `post-processing`. Turnstile, webhook e IndexNow lasciati vuoti vengono saltati e restano disattivati se non erano già presenti sul remoto. Dettagli e procedura di rimozione sono in [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md).

Dopo migrazioni, approvazione della fonte e revisione del file ufficiale, il bootstrap scrivente richiede due conferme esplicite:

```bash
DATA_IMPORT_DRY_RUN=false pnpm data:bootstrap:official -- \
  --reviewer=identificativo-revisore \
  --confirm-write
```

La procedura completa e i gate di pubblicazione sono in [`docs/DEPLOY_PRODUCTION.md`](docs/DEPLOY_PRODUCTION.md) e [`docs/DATA_PIPELINE.md`](docs/DATA_PIPELINE.md).

### Immagini responsive locali

Gli originali JPG in `public/images/` restano la fonte immutata e continuano a essere usati per Open Graph. `pnpm media:generate` produce sotto `public/images/responsive/v1/` soltanto le larghezze applicabili tra 480, 768, 1200 e 1600 px, in AVIF e WebP, senza upscaling. Il manifest versionato registra hash della sorgente, dimensioni, byte e hash di ogni variante; a parità di input la generazione non riscrive alcun file.

`ResponsiveImage.astro` costruisce `picture`, `srcset` e `sizes` dai medesimi contratti. La build esegue generazione e audit prima di Astro, poi verifica anche le copie in `dist/`. Per introdurre un nuovo originale occorre registrarlo in `src/config/responsive-images.json`, rigenerare gli asset e includere manifest e binari versionati.

## Quality gate di pubblicazione

Una build pubblica viene accettata soltanto quando sono presenti tutte e tre le condizioni:

```dotenv
PUBLIC_SITE_URL=https://www.dominio-reale.it
PUBLIC_SITE_MODE=production
PUBLIC_DATA_MODE=gold
```

Il dominio deve essere HTTPS pubblico e non può usare host locali o riservati. Il build valida realmente catalogo e collezioni: tier di maturità, confidence Gold e per campo almeno 0,70, core field, freshness, provenance per prezzi/attributi/diritti media, orari, origine dei tempi a piedi, coordinate nell’area di Milano, `schemaType`, fonti, fixture e consistenza editoriale. Soltanto Gold e Platinum possono essere candidate alla raccomandazione; Bronze e Silver restano consultabili in modalità `explore-only`. Lo stesso contratto rimuove dal ranking runtime una venue production appena verifica o provenance diventano stantie; le fixture restano ammesse solo nell'anteprima dichiarata e non sono mai pubblicabili. Impostare variabili “Gold” non aggira il controllo.

Superato il gate globale, l’indicizzazione resta governata per singola URL da `src/config/indexable-routes.json`:

- `draft`: pagina sempre `noindex`, esclusa dalla sitemap;
- `ready`: indicizzabile soltanto nella build pubblica;
- `lastmod`: cambia solo in seguito a una modifica editoriale reale, non a ogni build;
- `segment`: separa hub, discovery, contenuti editoriali, trust ed entity.

Prima di impostarle occorre completare ciò che dipende da dati e responsabilità esterne al repository:

1. sostituire `src/data/venues.ts` con il catalogo Gold autorizzato e le fonti reali previste dal contratto di provenance;
2. verificare identità, indirizzi, coordinate, orari, prezzi, accessibilità, fotografie e licenze;
3. pubblicare almeno una collection validata e registrare come `ready` soltanto le schede che superano il quality gate;
4. configurare il dominio reale in `PUBLIC_SITE_URL`;
5. approvare privacy policy, termini, cookie policy e flusso di correzione con i responsabili competenti;
6. collegare backend moderato, analytics/observability, query-gap e feedback soltanto dopo aver definito consenso e retention;
7. validare schema, crawl, Core Web Vitals e comportamento installabile sul dominio finale.

Finché uno di questi requisiti manca, l’app mostra il banner di anteprima, emette `noindex, follow`, blocca i crawler in `robots.txt` e non genera sitemap pubblica.

Per notificare una modifica materiale dopo il go-live:

```bash
pnpm indexnow -- /metodologia/ /fonti/        # dry run
pnpm indexnow -- /metodologia/ --send         # invio esplicito
```

Richiede `INDEXNOW_KEY`; la build pubblica genera il relativo file di ownership. Lo script rifiuta host esterni e URL non `ready`.

## Architettura

- Astro statico per HTML, routing, metadata e pagine editoriali.
- React island soltanto per ricerca, filtri, ranking e preferiti.
- Netlify Functions same-origin per catalogo, facet, schede, claim, manutenzione e interprete DeepSeek opzionale.
- Supabase Postgres 17 + PostGIS predisposto con 32 tabelle, migrazioni versionate, RLS forzata, RPC service-only, FTS italiano, trigrammi, indici spaziali e paginazione keyset.
- Pipeline amministrativa fail-closed: fonti disabilitate per default, import in `source_observations`, deduplicazione assistita, provenance per campo, retry/error ledger e pubblicazione Gold soltanto dopo revisione.
- TypeScript per contratti dati e ranking.
- Contratto analytics runtime-validato, pronto per la strumentazione ma privo per scelta di un consumer remoto.
- Vitest per parser, vincoli e composizione del podio.
- Playwright a 360/768/1440 px e axe per interazioni, ordine visuale, console e accessibilità bloccante.
- Lighthouse CI per performance, accessibilità, best practices, SEO e Core Web Vitals sintetici.
- Golden runner versionato per qualità del ranking e gate a codice di uscita non-zero.
- Configurazione unica `src/ranking/config.ts` per versione, pesi e soglie; dataset e runtime devono dichiarare la stessa `RANKING_VERSION`.
- Audit post-build per meta, canonical, JSON-LD, H1, link interni, robots e assenza di sitemap in preview.
- CSS proprietario responsive; nessuna dipendenza da un kit UI esterno.
- Font locali e fotografie create per il progetto, senza chiamate a CDN al runtime.
- Pipeline immagini riproducibile Sharp con AVIF/WebP locali, `srcset` e gate anti-upscale basato su manifest.

La parte database è implementata e versionata; lo stato del progetto remoto va verificato con la migration history collegata e con gli smoke test del runbook. Senza secrets validi le API rispondono `503` e il sito continua intenzionalmente in modalità dimostrativa `preview/fixture`, senza sostituire il database con dati inventati.

Documentazione operativa:

- [variabili d’ambiente](docs/ENVIRONMENT_VARIABLES.md) e template [`.env.example`](.env.example) / [`.env.production`](.env.production);
- [architettura dati e schema](docs/DATA_ARCHITECTURE.md);
- [pipeline, fonti e revisione](docs/DATA_PIPELINE.md);
- [deploy Supabase + Netlify](docs/DEPLOY_PRODUCTION.md);
- [bozze legali e privacy](docs/LEGAL_DRAFTS.md);
- [policy di fonti e diritti media](docs/SOURCE_POLICY.md).

`DEEPSEEK_API_KEY` va inserita esclusivamente nelle Environment Variables server-side di Netlify. Non deve avere prefisso `PUBLIC_` e non va mai salvata nel repository. DeepSeek interpreta l’intento strutturato, ma non riceve il catalogo e non sceglie i locali: il podio resta prodotto dal ranker deterministico TRE.

### Offline e riservatezza della ricerca

Il service worker viene registrato soltanto in una build pubblica idonea; le build preview lo disregistrano e cancellano le cache TRE esistenti. In produzione `/cerca/` è una shell precache. Una navigazione online usa sempre la rete; se fallisce, il worker risponde con la shell `/cerca/` usando `ignoreSearch`, così il client può leggere l’URL corrente e ricostruire il podio localmente. La richiesta personalizzata non viene mai inserita in Cache Storage e ogni altra URL con query, oltre a `/api/`, resta network-only.

La gerarchia dei PRD è rispettata: la strategia rivista governa le scelte; il blueprint specifica l’esecuzione dove non entra in conflitto.
