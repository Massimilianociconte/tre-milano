# Deploy produzione: Supabase + Netlify

Questa procedura separa migrazioni database, import e deploy frontend. Non eseguire DDL automaticamente dentro il build Netlify.

Il noindex globale della preview non è hardcoded in `netlify.toml`: il build genera `dist/_headers` soltanto in modalità `preview/fixture`. Quando i gate `production/gold` sono realmente superati, il file non contiene `X-Robots-Tag`, mentre meta robots, manifest e sitemap restano governati per singola URL. Il build audit blocca entrambe le configurazioni incoerenti.

## 1. Provisioning Supabase

1. Creare un progetto dedicato TRE Milano in una regione UE e scegliere un piano coerente con backup/RPO.
2. Conservare project ref, URL, secret key `sb_secret_*` e password DB in un password manager.
3. Verificare Postgres 17 e le estensioni PostGIS/pg_trgm/citext/pgcrypto previste dalle migrazioni.
4. Collegare la CLI senza salvare token nel repository:

```bash
supabase login
supabase link --project-ref "$SUPABASE_PROJECT_ID"
supabase migration list --linked
supabase db push --linked --dry-run
supabase db push --linked
```

Non usare `migration repair` senza aver prima confrontato la history remota. Le versioni locali sono univoche e ordinate; oltre al nucleo `...15041`–`...15043`, le migrazioni del 17 luglio 2026 aggiungono hardening, review ufficiale, acquisizione Open Data privata e provenance dei visual editoriali.

## 2. Verifica schema

In locale, con Docker attivo:

```bash
pnpm db:start
pnpm db:reset
pnpm db:lint
pnpm db:test
```

Sul progetto remoto eseguire gli advisor Supabase, controllare RLS/grant e poi un test read-only delle RPC con la secret key server moderna. Una richiesta con anon key a `venues`, `venue_claims` o alle RPC deve essere negata.

## 3. Approvazione e primo import

La migrazione `20260717092705_enable_milano_open_data_observations.sql` registra licenza, attribuzione e finalità e abilita le tre fonti comunali nel solo percorso di osservazione privata. Non modificarne il perimetro senza una nuova revisione legale/editoriale. Eseguire prima dry-run/export, poi import confermato come descritto in [DATA_PIPELINE.md](./DATA_PIPELINE.md). Le 14.682 righe grezze comunali non sono venue pubblicate: il checkpoint iniziale conserva 14.168 osservazioni accettate e 2 errori espliciti. Il catalogo pubblico richiede record verificati, provenance fresca e diritti immagini.

Per il dataset editoriale di fatti ufficiali già normalizzato, dopo aver verificato file, fonte e migrazione di review, eseguire il bootstrap esplicito:

```bash
DATA_IMPORT_DRY_RUN=false pnpm data:bootstrap:official -- \
  --reviewer=identificativo-revisore \
  --confirm-write
```

Il comando legge per default `data/official-venue-facts.ndjson` e `.env.pipeline`; accetta anche `--file=...`, `--source=...` e `--env=...`. Ogni record viene prima importato, poi sottoposto alla RPC di revisione ufficiale; retry, `import_runs`, risultato parziale e codice di uscita non-zero rendono visibili gli errori. `--reviewer` e la doppia conferma `DATA_IMPORT_DRY_RUN=false` + `--confirm-write` sono obbligatori: il bootstrap non sostituisce l’approvazione legale/editoriale della fonte.

## 4. Variabili Netlify

Creare `.env.netlify.local` a partire da [`.env.production`](../.env.production), senza commetterlo, e compilare almeno:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`
- `RATE_LIMIT_HASH_SECRET`
- `PUBLIC_SITE_URL`
- `PUBLIC_SITE_MODE`
- `PUBLIC_DATA_MODE`
- `DEEPSEEK_API_KEY` per rendere attivo l’interprete remoto richiesto dalla configurazione production

Sincronizzare esclusivamente l’allowlist prevista dal progetto:

```bash
pnpm netlify:env:sync
```

`SUPABASE_SERVICE_ROLE_KEY` non viene importata: la piattaforma usa la moderna `SUPABASE_SECRET_KEY`. Neppure token CLI, DB URL o variabili `DATA_IMPORT_*` arrivano a Netlify. Non aggiungere mai secret Supabase, Turnstile o DeepSeek a variabili `PUBLIC_*`.

Il piano Netlify collegato non consente scope personalizzati per le variabili non segrete. Lo script le imposta quindi nel contesto `production` lasciandole all-scope; i secret vengono marcati `is_secret=true` e verificati senza `post-processing`. Gli scope logici restano documentati in [ENVIRONMENT_VARIABLES.md](./ENVIRONMENT_VARIABLES.md): in particolare `PUBLIC_SITE_URL` serve anche alla claim Function e `PUBLIC_SITE_MODE` alla maintenance schedulata, non soltanto al build.

Il modulo pubblico attuale usa Netlify Forms. Lasciare vuoti `PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` e `TURNSTILE_EXPECTED_HOSTNAME` li fa saltare dal sync e mantiene la claim API disattivata/fail-closed. Configurarli soltanto nel cutover coordinato: widget, direttive CSP per `https://challenges.cloudflare.com`, informativa e test `202` devono essere rilasciati insieme. `CLAIM_RATE_LIMIT_PER_HOUR` e `CLAIM_RETENTION_DAYS` hanno default sicuri.

Anche `CLAIM_NOTIFICATION_WEBHOOK_URL`, `ALERT_WEBHOOK_URL` e `INDEXNOW_KEY` possono restare vuoti: nessun webhook viene chiamato e IndexNow resta inattivo. Il sync salta i vuoti ma non elimina valori remoti preesistenti; per disattivare una variabile già configurata usare `npx netlify env:unset NOME_VARIABILE`.

Le credenziali amministrative (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_ID`, `SUPABASE_DB_URL`, `DATA_IMPORT_*`) appartengono a [`.env.pipeline.example`](../.env.pipeline.example) e a un secret store CI separato; non importarle nel progetto Netlify.

I comandi dati preferiscono `.env.pipeline` e accettano `--env=<percorso>`. Prima dei comandi `supabase ...`, esportare invece le variabili dal secret store CI o dalla shell: la CLI non carica automaticamente il template della pipeline.

## 4bis. Continuous deployment da GitHub

Il sito Netlify `tre-milano-preview-160726` è collegato a `github.com/Massimilianociconte/tre-milano` (branch `main`):

- clone autenticato tramite deploy key Netlify registrata read-only sul repository GitHub;
- webhook GitHub verso `https://api.netlify.com/hooks/github` per `push`, `pull_request` e `delete`;
- comando build da `netlify.toml` (`node scripts/run-netlify-build.mjs`, publish `dist`, Node 22, pnpm 11.9.0).

Ogni push su `main` produce quindi un deploy automatico. I default restano fail-closed `preview/fixture`; il cutover Gold continua a passare esclusivamente dalle Environment Variables Netlify e dai gate di build.

## 5. Preview e smoke test

Mantenere `PUBLIC_SITE_MODE=preview` e `PUBLIC_DATA_MODE=fixture` durante la prova. Dopo deploy verificare:

```bash
curl -i "https://PREVIEW/api/catalog?limit=3"
curl -i "https://PREVIEW/api/catalog/facets"
curl -i "https://PREVIEW/api/venues/slug-verificato"
```

Controllare: una sola Function per endpoint, niente errori console, cache/ETag, 400 su filtri errati, 403 cross-origin, 429 oltre soglia, 503 se il DB viene deliberatamente scollegato, 404 per slug inesistente e nessuna chiave nel bundle/dist.

Per claim: testare Turnstile reale, risposta `202`, riga privata, webhook minimizzato, rate limit e cancellazione retention. Non usare PII reale nei test automatici.

## 6. Go-live Gold

Solo quando catalogo e pagine superano i gate:

1. snapshot/backup e restore test;
2. fonti/attribution/diritti media approvati;
3. campione duplicati e geocodifica revisionato;
4. termini/privacy/cookie approvati da un legale;
5. monitoraggio e contatti reclamo operativi;
6. `PUBLIC_SITE_MODE=production`, `PUBLIC_DATA_MODE=gold` e `PUBLIC_SITE_URL` HTTPS definitiva esplicitamente configurata; il build rifiuta un fallback Netlify in modalità Gold;
7. build, test completi e deploy Netlify;
8. smoke live, sitemap/robots/indexing e poi IndexNow.

## 7. Operations e rollback

- Maintenance Netlify: ogni giorno alle 03:17 UTC; retention, stale gate e queue delle fonti dovute.
- Controllare `import_runs`, `import_errors`, claim pendenti, duplicate candidates e venue prossime a `stale_after`.
- Backup DB giornaliero; PITR se l’RPO richiede granularità inferiore. Backup separato dei file media.
- Rollback applicazione: ripubblicare l’ultimo deploy Netlify sano.
- Rollback database: preferire migrazioni forward correttive; restore soltanto con piano downtime e verifica perdita dati.

## Interventi manuali ancora necessari

- rotazione delle chiavi Supabase e DeepSeek esposte durante la sessione operativa, poi nuova sincronizzazione Netlify e ridistribuzione;
- verifica contrattuale di piano, backup e prova di restore del progetto Supabase collegato;
- Turnstile soltanto al cutover coordinato della claim API; il flusso pubblico attuale resta Netlify Forms;
- revisione editoriale periodica dei 6 record Gold/Platinum iniziali e dei futuri candidati derivati dalle osservazioni private;
- configurazione dominio definitivo, DPA/fornitori e testi legali approvati;
- verifica backup/restore e alert webhook.
