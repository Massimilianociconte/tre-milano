# Variabili d’ambiente

Le variabili `PUBLIC_*` sono incorporabili nel frontend. Tutte le altre sono **server-only**. Non creare mai `PUBLIC_SUPABASE_SECRET_KEY`, `PUBLIC_SUPABASE_SERVICE_ROLE_KEY` o `PUBLIC_DEEPSEEK_API_KEY`.

La colonna “Scope logico” descrive dove il codice usa la variabile. Sul piano del progetto Netlify attualmente collegato, la CLI non consente di assegnare scope personalizzati alle variabili **non segrete**: `pnpm netlify:env:sync` le lascia quindi intenzionalmente all-scope. I valori segreti vengono invece salvati con `is_secret=true` e verificati senza scope `post-processing`.

| Variabile | Obbl. | Visibilità | Scope logico | Uso |
|---|---:|---|---|---|
| `PUBLIC_SITE_URL` | sì | pubblica | Build + Functions/runtime | origine canonica HTTPS; fallback hostname della claim Function |
| `PUBLIC_SITE_MODE` | sì | pubblica | Build + Functions/runtime | gate `preview`/`production`; letto anche dalla maintenance schedulata |
| `PUBLIC_DATA_MODE` | sì | pubblica | Build | `fixture` in preview; poi `gold` dopo audit catalogo |
| `PUBLIC_TURNSTILE_SITE_KEY` | futura | pubblica | Build | riservata al cutover del widget Cloudflare Turnstile; oggi il modulo pubblico usa Netlify Forms |
| `SUPABASE_URL` | sì | server-only | Functions/runtime + pipeline | endpoint progetto Supabase |
| `SUPABASE_SECRET_KEY` | sì | segreto server | Functions/runtime + pipeline | chiave `sb_secret_*` preferita; importata come secret e inviata soltanto in `apikey` |
| `SUPABASE_SERVICE_ROLE_KEY` | legacy | segreto server | pipeline/manuale soltanto | fallback JWT supportato localmente, ma escluso dall’allowlist `netlify:env:sync` e mai importato su Netlify |
| `RATE_LIMIT_HASH_SECRET` | sì | segreto server | Functions/runtime | salt casuale >=32 byte per hash IP/email |
| `TURNSTILE_SECRET_KEY` | sì solo al cutover claim | segreto server | Functions/runtime | verifica anti-abuso; vuota significa claim API disattivata/fail-closed |
| `TURNSTILE_EXPECTED_HOSTNAME` | no | server-only | Functions/runtime | hostname esatto accettato; fallback all’hostname di `PUBLIC_SITE_URL`, action fissa `venue_claim` |
| `DEEPSEEK_API_KEY` | sì nella configurazione Netlify production di questo progetto | segreto server | Functions/runtime | abilita l'interprete remoto; il runtime resta resiliente e usa il fallback deterministico se la chiave è assente o il provider non risponde |
| `DEEPSEEK_INTERPRETER_CACHE_TTL_SECONDS` | no | server-only | Functions/runtime | default 300, intervallo 0–3600; `0` disabilita la cache delle risposte |
| `DEEPSEEK_INTERPRETER_CACHE_MAX_ENTRIES` | no | server-only | Functions/runtime | default 200, intervallo 10–1000; limite per singola istanza serverless |
| `CATALOG_API_CACHE_SECONDS` | no | server-only | Functions/runtime | default 60, intervallo 0–3600 |
| `CATALOG_API_RATE_LIMIT` | no | server-only | Functions/runtime | default 120 richieste/min/IP |
| `CLAIM_RATE_LIMIT_PER_HOUR` | no | server-only | Functions/runtime | default 5 per hash IP+email |
| `CLAIM_RETENTION_DAYS` | no | server-only | Functions/runtime | default 365; range 30–1095 |
| `CLAIM_NOTIFICATION_WEBHOOK_URL` | no | segreto server | Functions/runtime | notifica minimizzata, senza PII; vuota = nessuna notifica |
| `ALERT_WEBHOOK_URL` | no | segreto server | Functions/runtime | alert maintenance minimizzato; vuota = nessun webhook |
| `DATA_IMPORT_DRY_RUN` | sì in pipeline | server-only | locale/CI | deve essere `false` + `--confirm-write` per scrivere |
| `DATA_IMPORT_BATCH_SIZE` | no | server-only | locale/CI | default 250, massimo DB 500 |
| `DATA_RPC_TIMEOUT_MS` | no | server-only | locale/CI | default 60000, intervallo 1000–120000 |
| `SUPABASE_ACCESS_TOKEN` | solo deploy DB | segreto | CLI/CI | link/push Supabase; non Netlify runtime |
| `SUPABASE_PROJECT_ID` | solo deploy DB | server-only | CLI/CI | project ref |
| `SUPABASE_DB_URL` | solo task SQL/backup | segreto | CLI/CI | connessione diretta/pooler; non frontend |
| `INDEXNOW_KEY` | no | verifica pubblicabile | Build + job esplicito | vuota fino al go-live; se presente il protocollo pubblica intenzionalmente `/{key}.txt` |
| `CHROME_PATH` | no | locale/CI | quality tooling | browser per Lighthouse |
| `LHCI_OUTPUT_DIR` | no | locale/CI | quality tooling | directory dei report Lighthouse; default `/tmp/tre-milano-lhci` |
| `PLAYWRIGHT_BASE_URL` | no | locale/CI | test | target E2E, anche preview live |
| `PLAYWRIGHT_ARTIFACTS_DIR` | no | locale/CI | test | output screenshot/trace |
| `CI` | no | locale/CI | test/build | comportamento non interattivo |

I template sono [`.env.example`](../.env.example), [`.env.production`](../.env.production) e [`.env.pipeline.example`](../.env.pipeline.example). Il template Production contiene soltanto variabili ammesse nel runtime/build Netlify e resta deliberatamente `preview/fixture`; il template pipeline contiene i privilegi CLI/DB e non deve essere importato su Netlify. I comandi `data:milano`, `data:import`, `data:bootstrap:official` e `data:health` caricano per default `.env.pipeline`, con fallback compatibile a `.env`; `--env=<percorso>` forza un file diverso. La Supabase CLI va invece avviata con le variabili esportate dal secret store CI o dalla shell.

Netlify valorizza automaticamente `URL` e `DEPLOY_PRIME_URL`; `netlify.toml` fissa `NODE_VERSION=22` e `PNPM_VERSION=11.9.0`. Sono variabili gestite/tooling, non secrets da copiare nel template Production.

## Netlify

Preparare il file locale ignorato da Git `.env.netlify.local`, collegare il progetto con la CLI e sincronizzare l’allowlist production:

```bash
pnpm netlify:env:sync
# opzionale: file diverso o singola chiave
pnpm netlify:env:sync -- --env=/percorso/sicuro/netlify.env
pnpm netlify:env:sync -- --only=DEEPSEEK_API_KEY
```

Lo script rifiuta placeholder e variabili obbligatorie mancanti, usa il site ID già presente in `.netlify/state.json`, non esegue sintassi shell contenuta nel file e non importa credenziali pipeline. In particolare `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN` e `SUPABASE_DB_URL` non appartengono all’allowlist. Sul piano collegato:

- le variabili non segrete vengono scritte nel contesto `production` senza `--scope`, quindi restano all-scope;
- `SUPABASE_SECRET_KEY`, `RATE_LIMIT_HASH_SECRET`, `DEEPSEEK_API_KEY` e gli eventuali secret Turnstile/webhook vengono marcati `is_secret=true`;
- lo script verifica che ogni secret remoto non includa lo scope `post-processing`;
- i valori opzionali vuoti o ancora placeholder vengono saltati, non creati e quindi restano disattivati in un progetto pulito.

Il fallback senza DeepSeek è una garanzia del runtime, non rende la chiave opzionale per la procedura di sincronizzazione production adottata da questo progetto: `pnpm netlify:env:sync` richiede `DEEPSEEK_API_KEY` perché la ricerca remota fa parte della configurazione production concordata. Le due variabili `DEEPSEEK_INTERPRETER_CACHE_*` sono opzionali, non segrete e incluse nell'allowlist server-only. La preview tecnica attualmente pubblicata usa davvero DeepSeek per le sole query complesse, resta `noindex` e registra solo metriche strutturate (esito, cache, tentativi, latenza e token), mai testo delle query o IP. Questa disponibilità tecnica non equivale al go-live: promozione, indicizzazione e dominio definitivo restano bloccati fino a verifica TIA/DPA, retention del provider e revisione legale finale.

Un valore vuoto locale non elimina una variabile già presente da una sincronizzazione precedente. Per disattivarla davvero usare la dashboard oppure `npx netlify env:unset NOME_VARIABILE`, quindi ridistribuire il sito. Lasciare vuoti Turnstile, i due webhook e `INDEXNOW_KEY` mantiene rispettivamente il flusso Netlify Forms, l’assenza di notifiche esterne e il mancato invio IndexNow. Dopo ogni sincronizzazione eseguire un nuovo deploy, necessario soprattutto per le variabili incorporate al build.

Generare `RATE_LIMIT_HASH_SECRET` localmente senza copiarlo in chat o repository, ad esempio con un password manager o CSPRNG. La rotazione azzera soltanto i bucket pseudonimi correnti; la rotazione della secret key richiede aggiornamento coordinato di Netlify e pipeline CI. Le nuove chiavi `sb_secret_*` non sono JWT: inviarle in `Authorization: Bearer` produce `Invalid JWT`, quindi il client distingue esplicitamente formato moderno e legacy. Vedere [migrazione alle nuove API key Supabase](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).

## Servizi senza chiavi esterne

- la mappa attuale è editoriale e usa coordinate già validate, senza tile provider o token cartografici;
- la posizione usa la Web Geolocation API del browser, senza una chiave server e senza persistenza delle coordinate;
- le immagini vengono generate e ottimizzate durante il build da asset locali con manifest e checksum;
- reverse geocoding e geocodifica massiva non sono attivi nel runtime: un eventuale provider autorizzato dovrà aggiungere credenziali esclusivamente server-side e una nuova voce ai template.

## Fail-closed

- Database assente/configurazione errata: API `503`, nessuna fixture sostitutiva.
- Turnstile assente: claim `503`, non accettato senza controllo anti-abuso.
- DeepSeek assente: ricerca semantica usa il fallback deterministico già esistente.
- Source disabilitata/licenza non approvata: import rifiutato dal database.
- Build `production/gold` senza `PUBLIC_SITE_URL` esplicita: build rifiutato; i fallback Netlify valgono soltanto per preview.
