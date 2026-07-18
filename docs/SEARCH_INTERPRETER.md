# Interprete remoto della ricerca

La ricerca conserva il ranking deterministico e i relativi gate. L'interprete remoto traduce esclusivamente una query libera nella tassonomia controllata di TRE Milano; non riceve il catalogo, non può restituire locali, identificativi, ranking o punteggi e non può allentare un vincolo duro trovato dal parser locale.

## Contratto

- Endpoint same-origin: `POST /api/search/interpret`
- Request JSON: `{ "version": "tre-search-interpretation-v2", "query": "..." }`
- Versione risposta: `tre-search-interpretation-v2`; il cambio di versione rende esplicita l'estensione chiusa del contratto e impedisce a un client v1 di interpretare silenziosamente campi nuovi
- Provider server-side: DeepSeek, modello stabile `deepseek-v4-flash`
- Budget upstream totale: 2,4 secondi; al massimo un retry per `429`, `502` o `503`, eseguito soltanto se resta tempo sufficiente. Il client interrompe a 2,6 secondi.
- Output massimo: 450 token, modalità non-thinking e JSON mode
- Rate limit: 12 richieste al minuto per combinazione IP e dominio
- Cache server best-effort: query canonica trasformata in SHA-256, TTL 300 secondi e massimo 200 voci per istanza; deduplicazione delle richieste equivalenti già in-flight

La risposta `source: "deepseek"` contiene un intento già riconciliato con il parser locale. Il modello può aggiungere preferenze morbide. Può proporre anche `require`, `require_any` o `exclude` soltanto nella tassonomia chiusa e soltanto quando la frase originale contiene un cue esplicito di obbligo o esclusione (per esempio “solo”, “deve”, “senza”, “evita”); i vincoli locali hanno sempre precedenza e nessun output remoto può allentarli. Una query già coperta dal parser locale non chiama il provider e restituisce `local_sufficient`; la lunghezza della frase, da sola, non attiva più una chiamata. Qualsiasi errore, timeout, risposta vuota/non valida, content filter o configurazione assente restituisce HTTP 200 con `source: "deterministic-fallback"` e un `fallbackReason` enumerato. Gli errori di protocollo o input usano invece 4xx.

Il contratto v2 valida con shape esatta e tassonomie chiuse anche:

- `partySize` (`1–50` oppure `null`), accettato solo in presenza di un numero esplicito nella query;
- `flexibility` (`strict`, `balanced`, `flexible`), ricalcolato deterministicamente dai cue testuali e mai usato per allentare un vincolo;
- signal `service` per spazio all'aperto, prenotazione, asporto, consegna, Wi-Fi, musica, pet friendly, parcheggio ed eventi privati;
- signal `dietary` per preferenza vegetariana o opzioni vegane non cliniche;
- `requiredOccasions`, che il ranker applica come gate soltanto quando espressioni locali come “solo aperitivo” lo rendono esplicito.

Servizi e preferenze alimentari entrano nel ranking soltanto attraverso attributi già presenti nel record Gold/API e la stessa tassonomia controllata dei concept. Un signal remoto senza cue testuale specifico viene scartato. Un modo remoto duro viene degradato a preferenza se la query originale non contiene un cue esplicito di obbligo o esclusione; quando il cue è presente, viene ammesso soltanto dopo normalizzazione e validazione closed-vocabulary.

## Limiti fail-closed

Il catalogo non espone ancora capienza/tavoli con provenance sufficiente. Query come “per 8 persone”, “siamo in 12”, “tavolo per 10”, “tavoli grandi” o “gruppo numeroso” producono `PARTY_SIZE` e nessun podio, anche se il numero viene estratto correttamente. Analogamente:

- senza glutine, celiachia, allergie e senza lattosio → `DIETARY_SAFETY`;
- halal, kosher o pescetariano, non presenti nella tassonomia verificata → `UNVERIFIED_DIETARY_OPTION`;
- area bambini, seggiolone, fasciatoio, guardaroba o ricarica elettrica → `UNVERIFIED_SERVICE`;
- accesso/bagno per sedia a rotelle → `ACCESSIBILITY` finché il ranking non dispone della provenance dedicata richiesta.

La flessibilità globale è metadata esplicativo: non modifica soglie, non crea candidati e non rilassa filtri. La flessibilità realmente applicata resta per-signal (`prefer`, `require`, `require_any`, `exclude`). Nessuno dei casi unsupported viene inviato al modello quando il parser locale lo riconosce già.

Il client deve validare ogni risposta con `isSearchInterpretationResponseV1` prima di convertirla tramite `interpretationToRankingOverrides`.

## Privacy e sicurezza

La Function non usa storage persistente e non invia `user_id`. Scrive esclusivamente eventi strutturati con origine, fallback, stato cache, tentativi, latenza e token dichiarati dal provider; non registra query, body o IP. I token vengono contabilizzati solo dalla richiesta che ha davvero raggiunto il provider, non dai cache hit o dalle richieste deduplicate. Query con email, telefono, URL, identificatori o segnali personali/sensibili vengono fermate prima della chiamata esterna e ricevono `fallbackReason: "privacy_guard"`; toponimi controllati come `Porta Romana` o `Quadrilatero della moda` non vengono confusi con nomi di persona. Prima dell'invio, inoltre, la frase viene ridotta a un vocabolario prodotto chiuso: nomi arbitrari e identificatori sconosciuti restano nel runtime TRE e non raggiungono DeepSeek. Il body non viene mai incluso nella risposta.

Sono accettati soltanto `POST`, `application/json` e richieste con `Origin` uguale all'origine dell'endpoint. La chiave viene letta esclusivamente dall'ambiente server della Netlify Function (`process.env` nel runtime Node, con compatibilità `Netlify.env` dove disponibile); non deve essere presente in una variabile `PUBLIC_*`, nel bundle Astro o nel repository.

## Configurazione Netlify

Impostare nel contesto deploy desiderato una variabile segreta denominata:

```text
DEEPSEEK_API_KEY
DEEPSEEK_INTERPRETER_CACHE_TTL_SECONDS=300
DEEPSEEK_INTERPRETER_CACHE_MAX_ENTRIES=200
```

Non inserire il valore della chiave in `.env.example`. In locale, usare una variabile non versionata gestita da Netlify CLI. Le due variabili cache sono opzionali, server-only e accettano rispettivamente `0–3600` secondi e `10–1000` voci; TTL `0` disabilita il riuso delle risposte ma conserva la deduplicazione in-flight. La cache vive soltanto nella memoria dell'istanza serverless e può essere svuotata da cold start o deploy. Se la chiave manca o il provider non risponde, il runtime resta utilizzabile con il parser locale e il fallback deterministico. La configurazione Netlify production adottata da questo progetto richiede tuttavia `DEEPSEEK_API_KEY` durante `pnpm netlify:env:sync`, perché l'interprete remoto fa parte del perimetro production concordato.

La preview tecnica attualmente pubblicata usa davvero DeepSeek per le sole query complesse. Rimane `noindex`, non invia catalogo, preferiti, coordinate o identificativi al provider e non registra intenzionalmente il testo delle query nei log applicativi. L'assenza della chiave continua a essere uno stato previsto e testato del runtime, non un errore di disponibilità.

L'attivazione tecnica in preview non autorizza il go-live. Promozione a `production/gold`, indicizzazione e dominio definitivo restano bloccati finché non sono stati approvati informativa e base giuridica, TIA/DPA o accordi applicabili, trasferimento internazionale, retention del provider e revisione legale finale.

Prima di pubblicare verificare:

```bash
pnpm check
pnpm test
```

Nel deploy log Netlify controllare anche che la regola di rate limiting della Function sia stata applicata. Il limite protegge dagli abusi per singolo IP, ma non costituisce un tetto di spesa globale: costi e utilizzo devono essere monitorati anche nel pannello DeepSeek e nelle metriche Functions di Netlify.
