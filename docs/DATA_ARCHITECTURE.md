# Architettura dati TRE Milano

Stato: implementazione versionata, non ancora applicata a un progetto Supabase remoto. Il runtime è intenzionalmente **fail-closed**: senza `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (o fallback legacy) e `RATE_LIMIT_HASH_SECRET` le API rispondono `503` e non ricadono sulle fixture.

## Flusso

```text
Browser
  │ same-origin HTTPS
  ▼
Netlify CDN + Functions
  ├─ GET  /api/catalog            ricerca/filtri/keyset pagination
  ├─ GET  /api/catalog/facets     filtri disponibili
  ├─ GET  /api/venues/:slug       scheda verificata
  ├─ POST /api/venue-claims       Turnstile + rate limit + minimizzazione PII
  └─ cron catalog-maintenance     scadenze, retention, code import
           │ service-role solo server
           ▼
Supabase Postgres 17
  ├─ PostGIS (geography/geometry + GIST)
  ├─ FTS italiano (tsvector + GIN) e pg_trgm
  ├─ catalogo/provenance/editoriale
  ├─ moderazione/claim/import audit
  └─ RPC service-only + RLS forzata, nessuna policy anon
```

Il browser non riceve mai la secret/service-role key e non accede direttamente a PostgREST. La publishable/anon key non è necessaria all’architettura attuale. Le chiavi moderne `sb_secret_*` sono inviate solo nell’header `apikey`; `Authorization: Bearer` è aggiunto esclusivamente per i JWT legacy.

## Modello relazionale

| Area | Tabelle principali | Garanzie |
|---|---|---|
| Tassonomia geografica | `municipalities`, `neighborhoods`, `venue_addresses` | SRID 4326, coordinate limitate all’area milanese, un solo indirizzo primario corrente, GIST |
| Catalogo | `venues`, `categories`, `subcategories`, `venue_contacts`, `venue_hours`, `venue_hour_exceptions`, `venue_prices`, `services`, `venue_services`, `venue_images` | vincoli di qualità, lifecycle, verifica, diritti media e freshness |
| Provenienza | `sources`, `source_records`, `source_observations`, `venue_field_sources`, `venue_update_history` | fonte per campo, checksum, validità, affidabilità e cronologia |
| Trust | `review_aggregates`, `duplicate_candidates` | rating sempre distinto per fonte; merge solo dopo revisione |
| Editoriale | `rankings`, `ranking_entries`, `podiums`, `podium_entries`, `guides`, `guide_venues` | snapshot/versione metodologia e ordine univoco |
| Moderazione | `user_reports`, `venue_claims` | dati privati, retention obbligatoria, stato/revisore |
| Operations | `import_runs`, `import_errors`, `import_queue`, `api_rate_limits` | retry/audit, dead-letter readiness e rate limit atomico persistente |

I dati amministrativi senza un nome commerciale verificabile entrano in `source_observations`, non in `venues`. Questo evita di pubblicare una licenza amministrativa come prova che un locale sia oggi aperto.

## Ricerca e paginazione

`search_venues` combina:

- `websearch_to_tsquery('italian', ...)` e indice GIN;
- similarità trigramma sul nome;
- `ST_DWithin` per raggio e `ST_Intersects` per viewport;
- filtri categoria, quartiere, servizi e prezzo;
- ordinamento per rilevanza, distanza, prezzo, rating o qualità;
- cursore keyset `(sort_value, uuid)`, limite pubblico massimo 50.

Le RPC restituiscono soltanto venue `active`, `verified`, pubblicate e non stantie. Prezzi e fasce entrano in lista, filtri, facet e dettaglio solo con `verified_at` e una finestra `valid_until` corrente; un import automatico non può rinnovare la freshness di una venue già pubblicata. Rating e conteggi rimangono array separati per fonte; non si ripubblicano recensioni individuali.

## Sicurezza

- RLS abilitata e `FORCE ROW LEVEL SECURITY` sulle tabelle.
- `anon` e `authenticated` non hanno grant diretti; le RPC sono eseguibili solo da `service_role`.
- Le function SQL sono `SECURITY INVOKER`, con `search_path=''`.
- Rate limit Netlify e secondo contatore atomico in Postgres, con IP/email pseudonimizzati mediante salt server-side.
- Body limit, validazione allow-list, same-origin, timeout database e messaggi d’errore sanitizzati.
- Claim protetti da Cloudflare Turnstile; webhook opzionale riceve soltanto ID, slug e tipo, non PII.
- Le immagini sono pubblicabili solo con stato diritti approvato, titolare e data di approvazione.
- Il quality score ignora provenance scaduta, record rimossi e fonti disabilitate o prive delle autorizzazioni d’uso richieste.

Riferimenti: [RLS Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostGIS Supabase](https://supabase.com/docs/guides/database/extensions/postgis), [Full Text Search](https://supabase.com/docs/guides/database/full-text-search).

## Cache, backup e ripristino

- Lista anonima senza query/geo e scheda: CDN cache breve configurabile, ETag e `stale-while-revalidate`. Richieste con `q`, coordinate o bounding box sono `private, no-store`, senza ETag riutilizzabile né header CDN; claim/errori non sono mai in cache.
- Gli asset media approvati possono usare Supabase Storage/CDN oppure URL esterni autorizzati.
- Produzione consigliata su Supabase Pro in regione UE, backup giornaliero e restore test trimestrale; PITR è opzionale in base a RPO/RTO.
- I file Storage non sono inclusi nei backup database: mantenere inventario/checksum e copia separata degli originali licenziati.

Vedere [backup Supabase](https://supabase.com/docs/guides/platform/backups) e [DEPLOY_PRODUCTION.md](./DEPLOY_PRODUCTION.md).
