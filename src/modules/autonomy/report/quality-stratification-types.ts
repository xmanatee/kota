export const QUALITY_SIGNALS = [
  "review-scrutiny",
  "code-health-drift",
  "post-completion-follow-up",
] as const;

export type QualitySignal = (typeof QUALITY_SIGNALS)[number];

export const QUALITY_STRATIFICATION_DIMENSIONS = [
  "workflow",
  "reviewSurface",
  "harness",
  "taskPriority",
  "taskClass",
  "taskArea",
  "reasonFamily",
  "changedArea",
] as const;

export type QualityStratificationDimension =
  (typeof QUALITY_STRATIFICATION_DIMENSIONS)[number];

export type QualityBucket = "current" | "prior";

export const QUALITY_STRATIFICATION_WEAK_SAMPLE_THRESHOLD = 3;

export const QUALITY_STRATIFICATION_DIMENSIONS_BY_SIGNAL: Record<
  QualitySignal,
  QualityStratificationDimension[]
> = {
  "review-scrutiny": [
    "workflow",
    "reviewSurface",
    "harness",
    "taskPriority",
    "taskClass",
    "taskArea",
    "changedArea",
  ],
  "code-health-drift": [
    "workflow",
    "harness",
    "taskPriority",
    "taskClass",
    "taskArea",
    "reasonFamily",
    "changedArea",
  ],
  "post-completion-follow-up": [
    "workflow",
    "harness",
    "taskPriority",
    "taskClass",
    "taskArea",
    "reasonFamily",
    "changedArea",
  ],
};

export type QualityRate = {
  sampleCount: number;
  numeratorCount: number;
  denominatorCount: number;
  rate: number | null;
};

export type QualitySignalAggregate = {
  signal: QualitySignal;
  current: QualityRate;
  prior: QualityRate;
  rateDelta: number | null;
  weakEvidence: boolean;
};

export type QualityReference = {
  runId?: string;
  taskId?: string;
  artifact?: string;
};

export type QualityObservation = {
  signal: QualitySignal;
  bucket: QualityBucket;
  denominator: boolean;
  numerator: boolean;
  dimensions: Partial<Record<QualityStratificationDimension, string[]>>;
  reference: QualityReference;
};

export type QualityStratificationSlice = {
  signal: QualitySignal;
  dimension: QualityStratificationDimension;
  value: string;
  current: QualityRate;
  prior: QualityRate;
  rateDelta: number | null;
  weakEvidence: boolean;
  references: QualityReference[];
};

export type QualityMissingDimensionCount = {
  signal: QualitySignal;
  dimension: QualityStratificationDimension;
  count: number;
};

export type QualityCompositionShift = {
  signal: QualitySignal;
  dimension: QualityStratificationDimension;
  value: string;
  currentSampleCount: number;
  priorSampleCount: number;
  currentShare: number;
  priorShare: number;
  shareDelta: number;
};

export type QualityStratificationReport = {
  weakSampleThreshold: number;
  aggregates: QualitySignalAggregate[];
  slices: QualityStratificationSlice[];
  missingDimensions: QualityMissingDimensionCount[];
  compositionShifts: QualityCompositionShift[];
};
