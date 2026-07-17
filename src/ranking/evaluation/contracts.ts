import type { RankingReasonCode, VenueCategory } from '../../domain/venue';

export type GoldenHardConstraints = {
  allowedCategories?: VenueCategory[];
  excludedCategories?: VenueCategory[];
  allowedNeighborhoods?: string[];
  excludedNeighborhoods?: string[];
  minSpend?: number;
  maxSpend?: number;
  maxMinutes?: number;
  requiresOpenNow?: boolean;
  serviceTime?: { weekday: number; minutes: number };
  requiredAtmospheres?: string[];
  requiredAnyAtmospheres?: string[];
  excludedAtmospheres?: string[];
  requiredTerms?: string[];
  excludedTerms?: string[];
  mustReturnEmpty?: boolean;
};

type GoldenQueryDefinition = {
  id: string;
  query: string;
  selectedOccasion?: string;
  acceptableVenueIds: string[];
  acceptableTop1Ids: string[];
  expectedUnsupportedCodes?: Array<'EXACT_OPENING_TIME' | 'DIETARY_SAFETY' | 'ACCESSIBILITY'>;
  hardConstraints: GoldenHardConstraints;
  reasonSupport: { anyOfCodes: RankingReasonCode[] };
};

export type GoldenQuery = GoldenQueryDefinition & (
  | {
      expectedEmpty: true;
      expectedPodiumSize?: never;
    }
  | {
      expectedEmpty?: false;
      /** Exact number of useful cards the annotated query can legitimately support. */
      expectedPodiumSize: 1 | 2 | 3;
    }
);

export type RankingEvalDataset = {
  schemaVersion: 1;
  datasetVersion: string;
  rankingVersion: string;
  catalogSnapshot: string;
  catalogMode: 'fixture' | 'gold';
  referenceDate: string;
  description: string;
  warmupRuns: number;
  measuredRuns: number;
  gates: {
    hardViolationRateMax: number;
    acceptablePodiumRateMin: number;
    top1AcceptableRateMin: number;
    explanationSupportRateMin: number;
    warmP95LatencyMsMax: number;
    coldP95LatencyMsMax: number;
  };
  queries: GoldenQuery[];
};

export type GateResult = {
  metric: string;
  actual: number;
  target: number;
  operator: '<=' | '>=' | '<';
  passed: boolean;
};

export type RankingEvalCaseResult = {
  id: string;
  query: string;
  resultIds: string[];
  expectedEmpty: boolean;
  returnedEmpty: boolean;
  expectedPodiumSize: number | null;
  acceptableResultCount: number | null;
  requiredAcceptableResultCount: number | null;
  acceptablePodium: boolean | null;
  top1Acceptable: boolean | null;
  hardViolations: Array<{ venueId: string; violations: string[] }>;
  explanationChecks: Array<{ venueId: string; supported: boolean; issues: string[] }>;
  podiumDiversityGain: number | null;
  thirdSelection: 'wildcard' | 'normal-fallback' | 'none';
  wildcardUseful: boolean | null;
  annotationIssues: string[];
  coldLatencyMs: number;
};

export type RankingEvalReport = {
  schemaVersion: 1;
  generatedAt: string;
  dataset: {
    version: string;
    rankingVersion: string;
    catalogSnapshot: string;
    catalogMode: 'fixture' | 'gold';
    referenceDate: string;
    queryCount: number;
    positiveQueryCount: number;
    expectedEmptyQueryCount: number;
  };
  metrics: {
    hardViolationRate: number;
    hardViolationCaseCount: number;
    hardViolationResultCount: number;
    acceptablePodiumRate: number;
    top1AcceptableRate: number;
    explanationSupportRate: number;
    podiumDiversityGain: number | null;
    podiumDiversitySampleCount: number;
    wildcardUtilityRate: number | null;
    wildcardSampleCount: number;
    normalThirdFallbackRate: number | null;
    normalThirdFallbackCount: number;
    completePodiumCount: number;
    emptyRate: number;
    unexpectedEmptyRate: number;
    expectedEmptyAccuracy: number;
    warmP95LatencyMs: number;
    coldP95LatencyMs: number;
    warmSampleCount: number;
  };
  gates: GateResult[];
  passed: boolean;
  fixtureBaseline: boolean;
  cases: RankingEvalCaseResult[];
};
