import { performance } from 'node:perf_hooks';
import { venues } from '../../data/venues';
import type { RankedVenue, SearchIntent, Venue } from '../../domain/venue';
import { isVenueRecommendationEligible } from '../../domain/venue';
import { RANKING_THRESHOLDS, RANKING_VERSION } from '../config';
import { normaliseItalian, parseIntent, rankVenues } from '../rank';
import type {
  GateResult,
  GoldenHardConstraints,
  GoldenQuery,
  RankingEvalCaseResult,
  RankingEvalDataset,
  RankingEvalReport,
} from './contracts';

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function travelMinutes(venue: Venue) {
  const compatible = venue as Venue & {
    minutes?: number;
    travelEstimate?: { minutes: number };
  };
  return compatible.travelEstimate?.minutes ?? compatible.minutes;
}

function percentile(values: number[], quantile: number) {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * quantile) - 1)];
}

function round(value: number, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function timeToMinutes(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : undefined;
}

/**
 * Eval-side schedule check. It deliberately reads the annotated venue fields
 * directly instead of calling the ranking hard-filter helper.
 */
function availableAt(venue: Venue, weekday: number, minutes: number) {
  if (weekday < 0 || weekday > 6 || minutes < 0 || minutes >= 1440) return false;
  const currentDay = WEEKDAYS[weekday];
  const previousDay = WEEKDAYS[(weekday + 6) % 7];
  const currentWindows = venue.availability.weekly[currentDay] ?? [];
  const previousWindows = venue.availability.weekly[previousDay] ?? [];

  const startsToday = currentWindows.some(({ opens, closes }) => {
    const start = timeToMinutes(opens);
    const end = timeToMinutes(closes);
    if (start === undefined || end === undefined) return false;
    return end > start ? minutes >= start && minutes < end : minutes >= start;
  });
  const continuesFromYesterday = previousWindows.some(({ opens, closes }) => {
    const start = timeToMinutes(opens);
    const end = timeToMinutes(closes);
    return start !== undefined && end !== undefined && end <= start && minutes < end;
  });
  return startsToday || continuesFromYesterday;
}

function venueEvidenceText(venue: Venue) {
  return normaliseItalian([
    venue.name,
    venue.neighborhood,
    venue.category,
    ...venue.atmosphere,
    ...venue.occasions,
    ...venue.features,
    ...(venue.semanticTags ?? []),
  ].join(' '));
}

function hardConstraintViolations(
  venue: Venue,
  constraints: GoldenHardConstraints,
  resultCount: number,
) {
  const violations: string[] = [];
  const evidence = venueEvidenceText(venue);
  const minutes = travelMinutes(venue);

  if (constraints.mustReturnEmpty && resultCount > 0) violations.push('must-return-empty');
  if (constraints.allowedCategories?.length && !constraints.allowedCategories.includes(venue.category)) {
    violations.push(`category-not-allowed:${venue.category}`);
  }
  if (constraints.excludedCategories?.includes(venue.category)) violations.push(`category-excluded:${venue.category}`);
  if (constraints.allowedNeighborhoods?.length && !constraints.allowedNeighborhoods.includes(venue.neighborhood)) {
    violations.push(`neighborhood-not-allowed:${venue.neighborhood}`);
  }
  if (constraints.excludedNeighborhoods?.includes(venue.neighborhood)) {
    violations.push(`neighborhood-excluded:${venue.neighborhood}`);
  }
  if (constraints.minSpend !== undefined && venue.averageSpend < constraints.minSpend) {
    violations.push(`spend-below-min:${venue.averageSpend}<${constraints.minSpend}`);
  }
  if (constraints.maxSpend !== undefined && venue.averageSpend > constraints.maxSpend) {
    violations.push(`spend-above-max:${venue.averageSpend}>${constraints.maxSpend}`);
  }
  if (constraints.maxMinutes !== undefined && minutes === undefined) {
    violations.push('distance-unverified');
  } else if (constraints.maxMinutes !== undefined && minutes !== undefined && minutes > constraints.maxMinutes) {
    violations.push(`distance-above-max:${minutes}>${constraints.maxMinutes}`);
  }
  if (constraints.requiresOpenNow && !venue.openStatus.value) violations.push('not-open-now');
  if (constraints.serviceTime && !availableAt(venue, constraints.serviceTime.weekday, constraints.serviceTime.minutes)) {
    violations.push(`unavailable:${constraints.serviceTime.weekday}/${constraints.serviceTime.minutes}`);
  }
  for (const mood of constraints.requiredAtmospheres ?? []) {
    if (!venue.atmosphere.includes(mood)) violations.push(`missing-atmosphere:${mood}`);
  }
  if (
    constraints.requiredAnyAtmospheres?.length
    && !constraints.requiredAnyAtmospheres.some((mood) => venue.atmosphere.includes(mood))
  ) {
    violations.push(`missing-any-atmosphere:${constraints.requiredAnyAtmospheres.join('|')}`);
  }
  for (const mood of constraints.excludedAtmospheres ?? []) {
    if (venue.atmosphere.includes(mood)) violations.push(`excluded-atmosphere:${mood}`);
  }
  for (const term of constraints.requiredTerms ?? []) {
    if (!evidence.includes(normaliseItalian(term))) violations.push(`missing-term:${term}`);
  }
  for (const term of constraints.excludedTerms ?? []) {
    if (evidence.includes(normaliseItalian(term))) violations.push(`excluded-term:${term}`);
  }

  return violations;
}

function hasTextualDataSupport(result: RankedVenue, intent: SearchIntent) {
  const reason = normaliseItalian(result.reason);
  const minutes = travelMinutes(result);
  const sourcePhrases = [
    result.neighborhood,
    result.category,
    ...result.atmosphere,
    ...result.occasions,
    ...result.features,
    ...result.matchedConcepts,
    ...(intent.requestedServiceTime ? [intent.requestedServiceTime.label] : []),
  ]
    .map(normaliseItalian)
    .filter((phrase) => phrase.length >= 4);

  if (sourcePhrases.some((phrase) => reason.includes(phrase))) return true;
  if (intent.maxSpend !== undefined && reason.includes('budget')) return true;
  if (intent.maxMinutes !== undefined && reason.includes('minuti')) return true;
  if (minutes !== undefined && reason.includes(`${minutes} minuti`)) return true;
  if (result.confidence >= RANKING_THRESHOLDS.highConfidence && reason.includes('alta confidenza')) return true;
  return reason.includes('rispetta i filtri richiesti');
}

function unsupportedReasonCodeIssues(result: RankedVenue, intent: SearchIntent, at: number) {
  const issues: string[] = [];
  for (const code of result.reasonCodes) {
    const supported = (() => {
      switch (code) {
        case 'GOLD_ELIGIBLE': return isVenueRecommendationEligible(result, at);
        case 'CATEGORY_MATCH': return intent.categories.includes(result.category);
        case 'NEIGHBORHOOD_MATCH': return intent.neighborhoods.includes(result.neighborhood);
        case 'ATMOSPHERE_MATCH': return intent.atmosphere.some((mood) => result.atmosphere.includes(mood));
        case 'FEATURE_MATCH': return result.matchedConcepts.length > 0;
        case 'PROFILE_MATCH': return result.profileMatches.length > 0;
        case 'OPEN_NOW': return result.openStatus.value;
        case 'CLOSE_BY': return (travelMinutes(result) ?? Number.POSITIVE_INFINITY) <= RANKING_THRESHOLDS.closeByMinutes;
        case 'HIGH_CONFIDENCE': return result.confidence >= RANKING_THRESHOLDS.highConfidence;
        case 'DIVERSITY_ALTERNATIVE': return result.rank > 1 && result.role === 'safe-alternative';
        case 'CONTROLLED_WILDCARD': return result.rank === 3 && result.role === 'smart-wildcard';
        // Occasion aliases and semantic stems are already represented by
        // deterministic structured evidence in rank.ts; text support is
        // independently checked above.
        case 'OCCASION_MATCH': return intent.occasions.length > 0;
        case 'SEMANTIC_MATCH': return intent.semanticTokens.length > 0;
        default: return false;
      }
    })();
    if (!supported) issues.push(`unsupported-reason-code:${code}`);
  }
  return issues;
}

function explanationCheck(
  result: RankedVenue,
  intent: SearchIntent,
  goldenQuery: GoldenQuery,
  at: number,
) {
  const issues: string[] = [];
  if (!result.reason.trim()) issues.push('empty-reason');
  const explanationReasons = result.reason
    .replace(/^[^:]+:\s*/, '')
    .replace(/\.$/, '')
    .split(';')
    .map((reason) => reason.trim())
    .filter(Boolean);
  if (explanationReasons.length !== RANKING_THRESHOLDS.explanationReasonLimit) {
    issues.push(`unexpected-reason-count:${explanationReasons.length}`);
  }
  if (!result.tradeoff.trim()) issues.push('empty-tradeoff');
  if (!hasTextualDataSupport(result, intent)) issues.push('reason-text-without-catalog-support');
  issues.push(...unsupportedReasonCodeIssues(result, intent, at));
  if (
    result.rank === 1
    && goldenQuery.reasonSupport.anyOfCodes.length
    && !goldenQuery.reasonSupport.anyOfCodes.some((code) => result.reasonCodes.includes(code))
  ) {
    issues.push(`missing-annotated-reason:${goldenQuery.reasonSupport.anyOfCodes.join('|')}`);
  }
  return { venueId: result.id, supported: issues.length === 0, issues };
}

function annotationIssues(
  goldenQuery: GoldenQuery,
  intent: SearchIntent,
  venueIds: Set<string>,
) {
  const issues: string[] = [];
  const acceptableIds = new Set(goldenQuery.acceptableVenueIds);
  if (goldenQuery.expectedEmpty) {
    if (goldenQuery.acceptableVenueIds.length || goldenQuery.acceptableTop1Ids.length) {
      issues.push('expected-empty-with-acceptable-ids');
    }
    if (!goldenQuery.hardConstraints.mustReturnEmpty) issues.push('expected-empty-without-hard-empty-contract');
    if (goldenQuery.expectedPodiumSize !== undefined) issues.push('expected-empty-with-podium-size');
  } else {
    if (!goldenQuery.acceptableVenueIds.length) issues.push('positive-query-without-acceptable-ids');
    if (!goldenQuery.acceptableTop1Ids.length) issues.push('positive-query-without-top1-ids');
    if (!goldenQuery.reasonSupport.anyOfCodes.length) issues.push('positive-query-without-reason-support');
    if (![1, 2, 3].includes(goldenQuery.expectedPodiumSize ?? 0)) {
      issues.push('positive-query-without-valid-expected-podium-size');
    } else {
      const requiredAcceptableResultCount = goldenQuery.expectedPodiumSize === 3 ? 2 : goldenQuery.expectedPodiumSize;
      if (acceptableIds.size < requiredAcceptableResultCount) {
        issues.push(`acceptable-set-below-podium-contract:${acceptableIds.size}<${requiredAcceptableResultCount}`);
      }
    }
  }
  for (const id of [...goldenQuery.acceptableVenueIds, ...goldenQuery.acceptableTop1Ids]) {
    if (!venueIds.has(id)) issues.push(`unknown-venue-id:${id}`);
  }
  for (const id of goldenQuery.acceptableTop1Ids) {
    if (!acceptableIds.has(id)) issues.push(`top1-not-in-acceptable-set:${id}`);
  }
  const actualUnsupported = new Set(intent.unsupportedConstraints.map(({ code }) => code));
  for (const code of goldenQuery.expectedUnsupportedCodes ?? []) {
    if (!actualUnsupported.has(code)) issues.push(`missing-unsupported-code:${code}`);
  }
  return issues;
}

function podiumAcceptability(goldenQuery: GoldenQuery, resultIds: string[]) {
  const expectedPodiumSize = goldenQuery.expectedPodiumSize ?? 3;
  const requiredAcceptableResultCount = expectedPodiumSize === 3 ? 2 : expectedPodiumSize;
  const acceptableIds = new Set(goldenQuery.acceptableVenueIds);
  const acceptableResultCount = resultIds
    .slice(0, 3)
    .filter((id, index, ids) => ids.indexOf(id) === index && acceptableIds.has(id))
    .length;

  return {
    expectedPodiumSize,
    requiredAcceptableResultCount,
    acceptableResultCount,
    acceptable: resultIds.length === expectedPodiumSize
      && acceptableResultCount >= requiredAcceptableResultCount,
  };
}

function podiumDiversityGain(results: RankedVenue[]) {
  const [first, ...alternatives] = results;
  if (!first || !alternatives.length) return null;

  const gainedAxes = alternatives.reduce((total, venue) => (
    total
      + Number(venue.category !== first.category)
      + Number(venue.neighborhood !== first.neighborhood)
  ), 0);
  return round(gainedAxes / (alternatives.length * 2));
}

function gate(metric: string, actual: number, target: number, operator: GateResult['operator']): GateResult {
  const passed = operator === '<=' ? actual <= target : operator === '>=' ? actual >= target : actual < target;
  return { metric, actual, target, operator, passed };
}

export function evaluateRanking(dataset: RankingEvalDataset): RankingEvalReport {
  const referenceDate = new Date(dataset.referenceDate);
  if (!Number.isFinite(referenceDate.getTime())) throw new Error(`referenceDate non valida: ${dataset.referenceDate}`);
  if (dataset.schemaVersion !== 1) throw new Error(`schemaVersion non supportata: ${dataset.schemaVersion}`);
  if (dataset.rankingVersion !== RANKING_VERSION) {
    throw new Error(`rankingVersion divergente: dataset=${dataset.rankingVersion}, runtime=${RANKING_VERSION}`);
  }
  if (dataset.warmupRuns < 1 || dataset.measuredRuns < 1) throw new Error('warmupRuns e measuredRuns devono essere positivi');

  const ids = dataset.queries.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error('Il golden set contiene id duplicati');

  const venueIds = new Set(venues.map(({ id }) => id));
  const caseResults: RankingEvalCaseResult[] = [];

  for (const goldenQuery of dataset.queries) {
    const intent = parseIntent(goldenQuery.query, goldenQuery.selectedOccasion, referenceDate);
    const startedAt = performance.now();
    const results = rankVenues(
      goldenQuery.query,
      goldenQuery.selectedOccasion,
      venues,
      {},
      undefined,
      referenceDate,
    );
    const coldLatencyMs = performance.now() - startedAt;
    const hardViolations = results
      .map((venue) => ({
        venueId: venue.id,
        violations: hardConstraintViolations(venue, goldenQuery.hardConstraints, results.length),
      }))
      .filter(({ violations }) => violations.length > 0);
    const expectedEmpty = Boolean(goldenQuery.expectedEmpty);
    const resultIds = results.map(({ id }) => id);
    const podium = expectedEmpty ? null : podiumAcceptability(goldenQuery, resultIds);
    const wildcard = results.find(({ rank, role }) => rank === 3 && role === 'smart-wildcard');
    const normalFallback = results.find(({ rank, role }) => rank === 3 && role === 'safe-alternative');
    const wildcardUseful = wildcard
      ? goldenQuery.acceptableVenueIds.includes(wildcard.id)
        && wildcard.divergenceDimensions.length === 1
        && !hardViolations.some(({ venueId }) => venueId === wildcard.id)
      : null;

    caseResults.push({
      id: goldenQuery.id,
      query: goldenQuery.query,
      resultIds,
      expectedEmpty,
      returnedEmpty: results.length === 0,
      expectedPodiumSize: podium?.expectedPodiumSize ?? null,
      acceptableResultCount: podium?.acceptableResultCount ?? null,
      requiredAcceptableResultCount: podium?.requiredAcceptableResultCount ?? null,
      acceptablePodium: podium?.acceptable ?? null,
      top1Acceptable: expectedEmpty
        ? null
        : Boolean(resultIds[0] && goldenQuery.acceptableTop1Ids.includes(resultIds[0])),
      hardViolations,
      explanationChecks: results.map((result) => explanationCheck(result, intent, goldenQuery, referenceDate.getTime())),
      podiumDiversityGain: podiumDiversityGain(results),
      thirdSelection: wildcard ? 'wildcard' : normalFallback ? 'normal-fallback' : 'none',
      wildcardUseful,
      annotationIssues: annotationIssues(goldenQuery, intent, venueIds),
      coldLatencyMs: round(coldLatencyMs, 3),
    });
  }

  for (let run = 0; run < dataset.warmupRuns; run += 1) {
    for (const goldenQuery of dataset.queries) {
      rankVenues(goldenQuery.query, goldenQuery.selectedOccasion, venues, {}, undefined, referenceDate);
    }
  }

  const warmSamples: number[] = [];
  for (let run = 0; run < dataset.measuredRuns; run += 1) {
    for (const goldenQuery of dataset.queries) {
      const startedAt = performance.now();
      rankVenues(goldenQuery.query, goldenQuery.selectedOccasion, venues, {}, undefined, referenceDate);
      warmSamples.push(performance.now() - startedAt);
    }
  }

  const positiveCases = caseResults.filter(({ expectedEmpty }) => !expectedEmpty);
  const expectedEmptyCases = caseResults.filter(({ expectedEmpty }) => expectedEmpty);
  const totalExplanationChecks = caseResults.flatMap(({ explanationChecks }) => explanationChecks);
  const hardViolationCases = caseResults.filter(({ hardViolations }) => hardViolations.length > 0);
  const hardViolationResults = caseResults.flatMap(({ hardViolations }) => hardViolations);
  const annotationIssueCount = caseResults.reduce((total, item) => total + item.annotationIssues.length, 0);
  const hardViolationRate = hardViolationCases.length / Math.max(1, caseResults.length);
  const acceptablePodiumRate = positiveCases.filter(({ acceptablePodium }) => acceptablePodium).length
    / Math.max(1, positiveCases.length);
  const top1AcceptableRate = positiveCases.filter(({ top1Acceptable }) => top1Acceptable).length
    / Math.max(1, positiveCases.length);
  const explanationSupportRate = totalExplanationChecks.filter(({ supported }) => supported).length
    / Math.max(1, totalExplanationChecks.length);
  const diversitySamples = positiveCases
    .map(({ podiumDiversityGain: value }) => value)
    .filter((value): value is number => value !== null);
  const podiumDiversityGainMetric = diversitySamples.length
    ? diversitySamples.reduce((total, value) => total + value, 0) / diversitySamples.length
    : null;
  const wildcardCases = positiveCases.filter(({ thirdSelection }) => thirdSelection === 'wildcard');
  const wildcardUtilityRate = wildcardCases.length
    ? wildcardCases.filter(({ wildcardUseful }) => wildcardUseful).length / wildcardCases.length
    : null;
  const completePodiumCases = positiveCases.filter(({ resultIds }) => resultIds.length === 3);
  const normalThirdFallbackCount = completePodiumCases
    .filter(({ thirdSelection }) => thirdSelection === 'normal-fallback')
    .length;
  const normalThirdFallbackRate = completePodiumCases.length
    ? normalThirdFallbackCount / completePodiumCases.length
    : null;
  const emptyRate = caseResults.filter(({ returnedEmpty }) => returnedEmpty).length / Math.max(1, caseResults.length);
  const unexpectedEmptyRate = positiveCases.filter(({ returnedEmpty }) => returnedEmpty).length
    / Math.max(1, positiveCases.length);
  const expectedEmptyAccuracy = expectedEmptyCases.filter(({ returnedEmpty }) => returnedEmpty).length
    / Math.max(1, expectedEmptyCases.length);
  const warmP95LatencyMs = percentile(warmSamples, 0.95);
  const coldP95LatencyMs = percentile(caseResults.map(({ coldLatencyMs }) => coldLatencyMs), 0.95);

  const gates: GateResult[] = [
    gate('hardViolationRate', hardViolationRate, dataset.gates.hardViolationRateMax, '<='),
    gate('acceptablePodiumRate', acceptablePodiumRate, dataset.gates.acceptablePodiumRateMin, '>='),
    gate('top1AcceptableRate', top1AcceptableRate, dataset.gates.top1AcceptableRateMin, '>='),
    gate('explanationSupportRate', explanationSupportRate, dataset.gates.explanationSupportRateMin, '>='),
    gate('warmP95LatencyMs', warmP95LatencyMs, dataset.gates.warmP95LatencyMsMax, '<'),
    gate('coldP95LatencyMs', coldP95LatencyMs, dataset.gates.coldP95LatencyMsMax, '<'),
    gate('datasetAnnotationIssues', annotationIssueCount, 0, '<='),
  ];

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    dataset: {
      version: dataset.datasetVersion,
      rankingVersion: dataset.rankingVersion,
      catalogSnapshot: dataset.catalogSnapshot,
      catalogMode: dataset.catalogMode,
      referenceDate: dataset.referenceDate,
      queryCount: caseResults.length,
      positiveQueryCount: positiveCases.length,
      expectedEmptyQueryCount: expectedEmptyCases.length,
    },
    metrics: {
      hardViolationRate: round(hardViolationRate),
      hardViolationCaseCount: hardViolationCases.length,
      hardViolationResultCount: hardViolationResults.length,
      acceptablePodiumRate: round(acceptablePodiumRate),
      top1AcceptableRate: round(top1AcceptableRate),
      explanationSupportRate: round(explanationSupportRate),
      podiumDiversityGain: podiumDiversityGainMetric === null ? null : round(podiumDiversityGainMetric),
      podiumDiversitySampleCount: diversitySamples.length,
      wildcardUtilityRate: wildcardUtilityRate === null ? null : round(wildcardUtilityRate),
      wildcardSampleCount: wildcardCases.length,
      normalThirdFallbackRate: normalThirdFallbackRate === null ? null : round(normalThirdFallbackRate),
      normalThirdFallbackCount,
      completePodiumCount: completePodiumCases.length,
      emptyRate: round(emptyRate),
      unexpectedEmptyRate: round(unexpectedEmptyRate),
      expectedEmptyAccuracy: round(expectedEmptyAccuracy),
      warmP95LatencyMs: round(warmP95LatencyMs, 3),
      coldP95LatencyMs: round(coldP95LatencyMs, 3),
      warmSampleCount: warmSamples.length,
    },
    gates,
    passed: gates.every(({ passed }) => passed),
    fixtureBaseline: dataset.catalogMode === 'fixture',
    cases: caseResults,
  };
}

const percentage = (value: number) => `${(value * 100).toFixed(1)}%`;
const optionalPercentage = (value: number | null) => value === null ? 'n/d' : percentage(value);

export function rankingEvalMarkdown(report: RankingEvalReport) {
  const metricRows = [
    ['Violazioni hard', percentage(report.metrics.hardViolationRate), `${report.metrics.hardViolationCaseCount} query / ${report.metrics.hardViolationResultCount} risultati`],
    ['Podi con copertura accettabile', percentage(report.metrics.acceptablePodiumRate), 'almeno 2/3; tutte le card se il podio atteso ne ha 1 o 2'],
    ['Top 1 accettabile', percentage(report.metrics.top1AcceptableRate), `${report.dataset.positiveQueryCount} query positive`],
    ['Spiegazioni supportate', percentage(report.metrics.explanationSupportRate), 'reason code + testo derivabile dai dati'],
    ['Empty rate', percentage(report.metrics.emptyRate), `attesi vuoti: ${report.dataset.expectedEmptyQueryCount}`],
    ['Unexpected empty rate', percentage(report.metrics.unexpectedEmptyRate), 'solo query positive'],
    ['Accuratezza empty attesi', percentage(report.metrics.expectedEmptyAccuracy), 'casi avversariali/safety'],
    ['p95 warm', `${report.metrics.warmP95LatencyMs.toFixed(3)} ms`, `${report.metrics.warmSampleCount} campioni`],
    ['p95 first-call', `${report.metrics.coldP95LatencyMs.toFixed(3)} ms`, `${report.dataset.queryCount} campioni`],
  ];
  const gateRows = report.gates.map((item) => [
    item.metric,
    item.metric.toLowerCase().includes('rate') || item.metric.toLowerCase().includes('coverage')
      ? percentage(item.actual)
      : item.actual.toFixed(3),
    `${item.operator} ${item.metric.toLowerCase().includes('rate') || item.metric.toLowerCase().includes('coverage') ? percentage(item.target) : item.target}`,
    item.passed ? 'PASS' : 'FAIL',
  ]);
  const diagnosticRows = [
    [
      'podiumDiversityGain',
      optionalPercentage(report.metrics.podiumDiversityGain),
      `${report.metrics.podiumDiversitySampleCount} podi con almeno due risultati; differenza media su categoria/zona`,
    ],
    [
      'wildcardUtilityRate',
      optionalPercentage(report.metrics.wildcardUtilityRate),
      `${report.metrics.wildcardSampleCount} wildcard; utile = accettabile nell'annotazione, una sola divergenza e zero violazioni hard`,
    ],
    [
      'normalThirdFallbackRate',
      optionalPercentage(report.metrics.normalThirdFallbackRate),
      `${report.metrics.normalThirdFallbackCount}/${report.metrics.completePodiumCount} podi completi usano una terza alternativa normale`,
    ],
  ];
  const failures = report.cases.filter((item) =>
    item.hardViolations.length
    || item.annotationIssues.length
    || item.acceptablePodium === false
    || item.top1Acceptable === false
    || item.explanationChecks.some(({ supported }) => !supported));
  const failureLines = failures.length
    ? failures.map((item) => {
      const details = [
        item.hardViolations.length ? `hard=${JSON.stringify(item.hardViolations)}` : '',
        item.acceptablePodium === false
          ? `podium=false (${item.acceptableResultCount}/${item.requiredAcceptableResultCount} accettabili; ${item.resultIds.length}/${item.expectedPodiumSize} card)`
          : '',
        item.top1Acceptable === false ? 'top1=false' : '',
        item.explanationChecks.some(({ supported }) => !supported) ? `reason=${JSON.stringify(item.explanationChecks.filter(({ supported }) => !supported))}` : '',
        item.annotationIssues.length ? `annotation=${item.annotationIssues.join(',')}` : '',
      ].filter(Boolean).join('; ');
      return `- \`${item.id}\` — risultati: ${item.resultIds.join(', ') || 'nessuno'}; ${details}`;
    }).join('\n')
    : '- Nessun errore nel dataset corrente.';

  return `# TRE Milano — ranking eval ${report.dataset.version}\n\n`
    + `Generato: ${report.generatedAt}\n\n`
    + `Esito: **${report.passed ? 'PASS' : 'FAIL'}**\n\n`
    + `> Baseline **fixture** (${report.dataset.catalogSnapshot}), ${report.dataset.queryCount} query. Serve a prevenire regressioni nel vertical slice; non sostituisce il gold set pre-lancio da almeno 200 query annotate da due valutatori.\n\n`
    + `## Metriche\n\n| Metrica | Valore | Nota |\n| --- | ---: | --- |\n`
    + metricRows.map((row) => `| ${row.join(' | ')} |`).join('\n')
    + `\n\n## Diagnostica composizione\n\nQueste metriche sono descrittive e non sono launch gate finché il gold set non contiene annotazioni dedicate.\n\n| Metrica | Valore | Definizione |\n| --- | ---: | --- |\n`
    + diagnosticRows.map((row) => `| ${row.join(' | ')} |`).join('\n')
    + `\n\n## Launch gate\n\n| Gate | Attuale | Target | Esito |\n| --- | ---: | ---: | --- |\n`
    + gateRows.map((row) => `| ${row.join(' | ')} |`).join('\n')
    + `\n\n## Diagnostica\n\n${failureLines}\n\n`
    + `## Gate per ricerca vettoriale\n\nEmbedding e vector search restano disabilitati. Un candidato ibrido può essere abilitato soltanto dopo un miglioramento pairwise misurato contro questa baseline versionata, senza regressioni su vincoli hard, spiegabilità o latenza.\n`;
}
