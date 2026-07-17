# Contratto analytics locale e privacy-first

`src/analytics/events.ts` definisce il vocabolario di misurazione del vertical slice. Non è un provider analytics e non invia dati: crea un envelope validato e, nel browser, emette soltanto il `CustomEvent` locale `tre-milano:analytics-event`.

## Garanzie del contratto

- schema versionato (`schemaVersion: 1`);
- `eventId`, `correlationId`, `idempotencyKey` e timestamp ISO su ogni evento;
- `privacyClass` determinata dal nome dell’evento, non dal chiamante;
- proprietà in allowlist, con enum, booleani, conteggi limitati e soli slug tecnici delle venue;
- query libera, coordinate, nomi, email, telefono, indirizzi e proprietà arbitrarie rifiutati a runtime;
- nessun `fetch`, beacon, cookie, `localStorage` o `sessionStorage`;
- nessun listener registrato di default: senza un consumer esplicito il dispatch è un no-op locale.

## Tassonomia v1

| Evento | Privacy class | Proprietà ammesse |
| --- | --- | --- |
| `search_started` | `product_measurement` | entry point, presenza filtri e contesto posizione |
| `intent_parsed` | `product_measurement` | conteggi di vincoli, vincoli duri e vincoli non supportati |
| `podium_shown` | `product_measurement` | numero risultati, presenza wildcard, profilo applicato |
| `podium_low_confidence` | `quality_signal` | numero risultati e reason code chiuso |
| `card_opened` | `product_measurement` | venue ID tecnico, rank e ruolo; il rank 3 può essere wildcard o alternativa normale |
| `venue_saved` | `product_measurement` | venue ID tecnico, stato e superficie di origine |
| `podium_shared` | `product_measurement` | numero risultati, metodo e contesto individuale/gruppo |
| `wildcard_explained` | `quality_signal` | venue ID tecnico e dimensione della divergenza |
| `wildcard_replaced` | `quality_signal` | venue ID tecnico, esito e dimensione opzionale |
| `feedback_submitted` | `quality_signal` | target, codice chiuso e venue ID tecnico opzionale |

Non esiste una proprietà per il testo della query. Il parser dovrà emettere soltanto conteggi e categorie già aggregate.

## API pronta per la strumentazione

```ts
import { createAnalyticsDispatcher } from '@/analytics/events';

const analytics = createAnalyticsDispatcher();

analytics.emit('podium_shown', {
  resultCount: 3,
  hasWildcard: true,
  profileApplied: false,
}, {
  idempotencyKey: 'podium:request-42',
});
```

Un’intera interazione può riusare `analytics.correlationId`. Se una stessa azione può essere ripetuta dal rendering, il chiamante deve riusare la medesima `idempotencyKey`; `eventId` rimane invece univoco per envelope.

## Confine prima di un trasporto remoto

Un eventuale consumer di rete è fuori da questo contratto e non va aggiunto implicitamente. Prima servono finalità, consenso quando applicabile, retention, soglie di aggregazione, gestione dei diritti e revisione privacy. Fino ad allora gli eventi non costituiscono telemetria raccolta né prova di KPI reali.
