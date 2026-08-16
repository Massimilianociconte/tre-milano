# TRE Milano — ranking eval fixture-baseline-v1

Generato: 2026-08-16T18:54:35.620Z

Esito: **PASS**

> Baseline **fixture** (fixture-2026-07-16), 30 query. Serve a prevenire regressioni nel vertical slice; non sostituisce il gold set pre-lancio da almeno 200 query annotate da due valutatori.

## Metriche

| Metrica | Valore | Nota |
| --- | ---: | --- |
| Violazioni hard | 0.0% | 0 query / 0 risultati |
| Podi con copertura accettabile | 100.0% | almeno 2/3; tutte le card se il podio atteso ne ha 1 o 2 |
| Top 1 accettabile | 100.0% | 24 query positive |
| Spiegazioni supportate | 100.0% | reason code + testo derivabile dai dati |
| Empty rate | 20.0% | attesi vuoti: 6 |
| Unexpected empty rate | 0.0% | solo query positive |
| Accuratezza empty attesi | 100.0% | casi avversariali/safety |
| p95 warm | 0.951 ms | 600 campioni |
| p95 first-call | 3.876 ms | 30 campioni |

## Diagnostica composizione

Queste metriche sono descrittive e non sono launch gate finché il gold set non contiene annotazioni dedicate.

| Metrica | Valore | Definizione |
| --- | ---: | --- |
| podiumDiversityGain | 70.0% | 5 podi con almeno due risultati; differenza media su categoria/zona |
| wildcardUtilityRate | 100.0% | 1 wildcard; utile = accettabile nell'annotazione, una sola divergenza e zero violazioni hard |
| normalThirdFallbackRate | 0.0% | 0/1 podi completi usano una terza alternativa normale |

## Launch gate

| Gate | Attuale | Target | Esito |
| --- | ---: | ---: | --- |
| hardViolationRate | 0.0% | <= 0.0% | PASS |
| acceptablePodiumRate | 100.0% | >= 95.0% | PASS |
| top1AcceptableRate | 100.0% | >= 80.0% | PASS |
| explanationSupportRate | 100.0% | >= 98.0% | PASS |
| warmP95LatencyMs | 0.951 | < 700 | PASS |
| coldP95LatencyMs | 3.876 | < 1500 | PASS |
| datasetAnnotationIssues | 0.000 | <= 0 | PASS |

## Diagnostica

- Nessun errore nel dataset corrente.

## Gate per ricerca vettoriale

Embedding e vector search restano disabilitati. Un candidato ibrido può essere abilitato soltanto dopo un miglioramento pairwise misurato contro questa baseline versionata, senza regressioni su vincoli hard, spiegabilità o latenza.
