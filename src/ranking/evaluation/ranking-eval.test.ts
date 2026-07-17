import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { venues } from '../../data/venues';
import type { GoldenQuery, RankingEvalDataset } from './contracts';
import { evaluateRanking, rankingEvalMarkdown } from './evaluate-ranking';
import { RANKING_VERSION } from '../config';

const datasetPath = fileURLToPath(new URL('./golden-queries.v1.json', import.meta.url));

describe('ranking golden evaluation', () => {
  it('rifiuta un golden set riferito a una versione ranking diversa dal runtime', async () => {
    const baseline = JSON.parse(await readFile(datasetPath, 'utf8')) as RankingEvalDataset;
    expect(baseline.rankingVersion).toBe(RANKING_VERSION);
    expect(() => evaluateRanking({ ...baseline, rankingVersion: 'deterministic-local-stale' }))
      .toThrow(`dataset=deterministic-local-stale, runtime=${RANKING_VERSION}`);
  });

  it('scrive i report e blocca la release se un launch gate non è rispettato', async () => {
    const dataset = JSON.parse(await readFile(datasetPath, 'utf8')) as RankingEvalDataset;
    const report = evaluateRanking(dataset);
    const reportBase = resolve(process.cwd(), 'reports', 'ranking', dataset.datasetVersion);
    await mkdir(dirname(reportBase), { recursive: true });
    await Promise.all([
      writeFile(`${reportBase}.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
      writeFile(`${reportBase}.md`, rankingEvalMarkdown(report), 'utf8'),
    ]);

    const failedGates = report.gates
      .filter(({ passed }) => !passed)
      .map(({ metric, actual, operator, target }) => `${metric}: ${actual} ${operator} ${target}`);
    console.info(
      `[ranking-eval] ${report.passed ? 'PASS' : 'FAIL'} ${dataset.datasetVersion} — `
      + `hard ${(report.metrics.hardViolationRate * 100).toFixed(1)}%, `
      + `podium ${(report.metrics.acceptablePodiumRate * 100).toFixed(1)}%, `
      + `top1 ${(report.metrics.top1AcceptableRate * 100).toFixed(1)}%, `
      + `explain ${(report.metrics.explanationSupportRate * 100).toFixed(1)}%, `
      + `p95 ${report.metrics.warmP95LatencyMs.toFixed(3)} ms`,
    );
    console.info(`[ranking-eval] report: ${reportBase}.json | ${reportBase}.md`);

    expect(failedGates, `Launch gate falliti:\n${failedGates.join('\n')}`).toEqual([]);
    expect(report.cases.find(({ id }) => id === 'occasion-first-date')).toMatchObject({
      expectedPodiumSize: 3,
      acceptableResultCount: 3,
      requiredAcceptableResultCount: 2,
      acceptablePodium: true,
    });
    expect(report.cases.find(({ id }) => id === 'core-brera-aperitivo')).toMatchObject({
      expectedPodiumSize: 1,
      acceptableResultCount: 1,
      requiredAcceptableResultCount: 1,
      acceptablePodium: true,
    });
    expect(report.metrics.podiumDiversityGain).not.toBeNull();
    expect(report.metrics.wildcardUtilityRate).toBe(1);
    expect(report.metrics.wildcardSampleCount).toBeGreaterThan(0);
    expect(report.gates.map(({ metric }) => metric)).not.toEqual(expect.arrayContaining([
      'podiumDiversityGain',
      'wildcardUtilityRate',
      'normalThirdFallbackRate',
    ]));
  }, 30_000);

  it('rende fallibile il gate quando un risultato viola un contratto hard annotato', async () => {
    const baseline = JSON.parse(await readFile(datasetPath, 'utf8')) as RankingEvalDataset;
    const breached: RankingEvalDataset = {
      ...baseline,
      datasetVersion: 'deliberate-gate-breach',
      warmupRuns: 1,
      measuredRuns: 1,
      queries: [{
        id: 'must-be-empty-but-is-not',
        query: 'aperitivo',
        acceptableVenueIds: [],
        acceptableTop1Ids: [],
        expectedEmpty: true,
        hardConstraints: { mustReturnEmpty: true },
        reasonSupport: { anyOfCodes: [] },
      }],
    };
    const report = evaluateRanking(breached);

    expect(report.passed).toBe(false);
    expect(report.metrics.hardViolationRate).toBe(1);
    expect(report.gates.find(({ metric }) => metric === 'hardViolationRate')?.passed).toBe(false);
  });

  it('non considera accettabile un podio da tre con un solo risultato annotato come valido', async () => {
    const baseline = JSON.parse(await readFile(datasetPath, 'utf8')) as RankingEvalDataset;
    const query = baseline.queries.find(({ id }) => id === 'occasion-first-date');
    expect(query).toBeDefined();
    const insufficientCoverage: RankingEvalDataset = {
      ...baseline,
      datasetVersion: 'deliberate-one-of-three-breach',
      warmupRuns: 1,
      measuredRuns: 1,
      queries: [{
        ...query!,
        expectedEmpty: false,
        acceptableVenueIds: ['lume-brera', 'quota-ventuno'],
        acceptableTop1Ids: ['lume-brera'],
        expectedPodiumSize: 3,
      }],
    };
    const report = evaluateRanking(insufficientCoverage);
    const [result] = report.cases;

    expect(result.annotationIssues).toEqual([]);
    expect(result.acceptableResultCount).toBe(1);
    expect(result.requiredAcceptableResultCount).toBe(2);
    expect(result.acceptablePodium).toBe(false);
    expect(report.metrics.acceptablePodiumRate).toBe(0);
    expect(report.gates.find(({ metric }) => metric === 'acceptablePodiumRate')?.passed).toBe(false);
  });

  it('rifiuta annotazioni positive che omettono la dimensione legittima del podio', async () => {
    const baseline = JSON.parse(await readFile(datasetPath, 'utf8')) as RankingEvalDataset;
    const query = baseline.queries.find(({ id }) => id === 'core-brera-aperitivo');
    expect(query).toBeDefined();
    const { expectedPodiumSize: _omitted, ...withoutPodiumContract } = query!;
    const missingContract: RankingEvalDataset = {
      ...baseline,
      datasetVersion: 'deliberate-missing-podium-contract',
      warmupRuns: 1,
      measuredRuns: 1,
      queries: [withoutPodiumContract as GoldenQuery],
    };
    const report = evaluateRanking(missingContract);

    expect(report.cases[0].annotationIssues).toContain('positive-query-without-valid-expected-podium-size');
    expect(report.gates.find(({ metric }) => metric === 'datasetAnnotationIssues')?.passed).toBe(false);
  });

  it('misura il fallback normale in terza posizione senza trasformarlo in gate', async () => {
    const baseline = JSON.parse(await readFile(datasetPath, 'utf8')) as RankingEvalDataset;
    const allVenueIds = venues.map(({ id }) => id);
    const fallbackDataset: RankingEvalDataset = {
      ...baseline,
      datasetVersion: 'normal-third-fallback-diagnostic',
      warmupRuns: 1,
      measuredRuns: 1,
      queries: [{
        id: 'hard-filter-with-normal-fallback',
        query: 'budget 100',
        expectedPodiumSize: 3,
        acceptableVenueIds: allVenueIds,
        acceptableTop1Ids: allVenueIds,
        hardConstraints: {},
        reasonSupport: { anyOfCodes: ['GOLD_ELIGIBLE'] },
      }],
    };
    const report = evaluateRanking(fallbackDataset);

    expect(report.cases[0]).toMatchObject({
      thirdSelection: 'normal-fallback',
      wildcardUseful: null,
      acceptablePodium: true,
    });
    expect(report.metrics.normalThirdFallbackCount).toBe(1);
    expect(report.metrics.normalThirdFallbackRate).toBe(1);
    expect(report.metrics.wildcardUtilityRate).toBeNull();
    expect(report.gates.some(({ metric }) => metric === 'normalThirdFallbackRate')).toBe(false);
  });
});
