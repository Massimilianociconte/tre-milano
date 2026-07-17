# Valutazione versionata del ranking

Il comando seguente esegue la baseline deterministica e termina con codice diverso da zero se un launch gate non è rispettato:

```bash
pnpm eval:ranking
```

Il golden set `fixture-baseline-v1` vive in `src/ranking/evaluation/golden-queries.v1.json`. Ogni query positiva annota la dimensione esatta del podio legittimamente supportabile, gli ID accettabili, gli ID ammessi in prima posizione, i vincoli hard indipendenti dal parser e i reason code che devono sostenere la spiegazione. Il runner usa una data di riferimento fissa, misura cold first-call e warm p95, e scrive:

- `reports/ranking/fixture-baseline-v1.json`, report machine-readable completo per query;
- `reports/ranking/fixture-baseline-v1.md`, sintesi umana con gate e diagnostica.

Pesi, soglie e `RANKING_VERSION` vivono in `src/ranking/config.ts`. Il runner interrompe l'esecuzione prima delle metriche se `rankingVersion` del dataset non coincide con quella runtime: una modifica comportamentale non può quindi riusare silenziosamente una baseline riferita a un algoritmo diverso.

I gate della strategia sono: 0% violazioni hard, almeno 95% di podi accettabili, almeno 80% di Top 1 accettabili e almeno 98% di spiegazioni supportate. Un podio da tre passa solo con almeno due risultati annotati come accettabili; se l'annotazione dichiara legittimamente una o due card, il runner richiede esattamente quella dimensione e che tutte le card siano accettabili. Il runner applica anche i budget p95 del PRD: meno di 700 ms warm e meno di 1,5 s sul primo invio misurato nel processo.

Questa è esplicitamente una baseline fixture di 30 query su sei venue Gold/Platinum simulate, rimaste invariate all'interno di un catalogo dimostrativo da 20 record. Le altre 14 venue Bronze/Silver sono `explore-only` e il contratto di maturità le esclude dal ranking. La baseline non sostituisce il gold set di lancio: prima del pubblico servono almeno 200 query rappresentative e casi avversariali annotati da due valutatori; la strategia finale richiede la review su 300 query.

## Diagnostiche di composizione

Il report espone inoltre `podiumDiversityGain` (differenza media di categoria/zona rispetto al #1), `wildcardUtilityRate` (wildcard annotata come accettabile, con una sola divergenza e zero violazioni hard) e `normalThirdFallbackRate` (podi completi in cui il #3 è un'alternativa rilevante perché non esiste una wildcard sicura). Sono metriche descrittive: non diventano gate finché il gold set non contiene annotazioni dedicate e una soglia approvata.

## Gate embedding e ricerca vettoriale

Embedding, vector search e fusion ranking restano disabilitati finché un candidato ibrido non dimostra un miglioramento pairwise misurato contro questa baseline versionata. Il miglioramento non può compensare regressioni su vincoli hard, spiegabilità, fallback deterministico o p95: se uno di questi gate peggiora, la baseline lessicale rimane il percorso attivo.
