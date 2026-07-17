# Interprete remoto della ricerca

La ricerca conserva il ranking deterministico e i relativi gate. L'interprete remoto traduce esclusivamente una query libera nella tassonomia controllata di TRE Milano; non riceve il catalogo, non può restituire locali, identificativi, ranking o punteggi e non può allentare un vincolo duro trovato dal parser locale.

## Contratto

- Endpoint same-origin: `POST /api/search/interpret`
- Request JSON: `{ "version": "tre-search-interpretation-v1", "query": "..." }`
- Versione risposta: `tre-search-interpretation-v1`
- Provider server-side: DeepSeek, modello stabile `deepseek-v4-flash`
- Timeout upstream: 2,4 secondi; nessun retry automatico. Il client interrompe a 2,6 secondi.
- Output massimo: 450 token, modalità non-thinking e JSON mode
- Rate limit: 12 richieste al minuto per combinazione IP e dominio

La risposta `source: "deepseek"` contiene un intento già riconciliato con il parser locale. Una query già coperta dal parser locale non chiama il provider e restituisce `local_sufficient`. Qualsiasi errore, timeout, risposta vuota/non valida, content filter o configurazione assente restituisce HTTP 200 con `source: "deterministic-fallback"` e un `fallbackReason` enumerato. Gli errori di protocollo o input usano invece 4xx.

Il client deve validare ogni risposta con `isSearchInterpretationResponseV1` prima di convertirla tramite `interpretationToRankingOverrides`.

## Privacy e sicurezza

La Function non scrive log applicativi e non usa storage. Non invia `user_id`. Query con email, telefono, URL, identificatori o segnali personali/sensibili vengono fermate prima della chiamata esterna e ricevono `fallbackReason: "privacy_guard"`. Il body non viene mai incluso nella risposta.

Sono accettati soltanto `POST`, `application/json` e richieste con `Origin` uguale all'origine dell'endpoint. La chiave viene letta esclusivamente dall'ambiente server della Netlify Function (`process.env` nel runtime Node, con compatibilità `Netlify.env` dove disponibile); non deve essere presente in una variabile `PUBLIC_*`, nel bundle Astro o nel repository.

## Configurazione Netlify

Impostare nel contesto deploy desiderato una variabile segreta denominata:

```text
DEEPSEEK_API_KEY
```

Non inserire il valore in `.env.example`. In locale, usare una variabile non versionata gestita da Netlify CLI. Se la variabile manca o il provider non risponde, il runtime resta utilizzabile con il parser locale e il fallback deterministico. La configurazione Netlify production adottata da questo progetto richiede tuttavia `DEEPSEEK_API_KEY` durante `pnpm netlify:env:sync`, perché l'interprete remoto fa parte del perimetro production concordato.

La preview tecnica attualmente pubblicata usa davvero DeepSeek per le sole query complesse. Rimane `noindex`, non invia catalogo, preferiti, coordinate o identificativi al provider e non registra intenzionalmente il testo delle query nei log applicativi. L'assenza della chiave continua a essere uno stato previsto e testato del runtime, non un errore di disponibilità.

L'attivazione tecnica in preview non autorizza il go-live. Promozione a `production/gold`, indicizzazione e dominio definitivo restano bloccati finché non sono stati approvati informativa e base giuridica, TIA/DPA o accordi applicabili, trasferimento internazionale, retention del provider e revisione legale finale.

Prima di pubblicare verificare:

```bash
pnpm check
pnpm test
```

Nel deploy log Netlify controllare anche che la regola di rate limiting della Function sia stata applicata. Il limite protegge dagli abusi per singolo IP, ma non costituisce un tetto di spesa globale: costi e utilizzo devono essere monitorati anche nel pannello DeepSeek e nelle metriche Functions di Netlify.
