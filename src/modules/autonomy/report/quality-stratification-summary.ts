import {
  QUALITY_SIGNALS,
  QUALITY_STRATIFICATION_DIMENSIONS_BY_SIGNAL,
  QUALITY_STRATIFICATION_WEAK_SAMPLE_THRESHOLD,
  type QualityCompositionShift,
  type QualityMissingDimensionCount,
  type QualityObservation,
  type QualityRate,
  type QualityReference,
  type QualitySignal,
  type QualitySignalAggregate,
  type QualityStratificationDimension,
  type QualityStratificationReport,
  type QualityStratificationSlice,
} from "./quality-stratification-types.js";

const SLICE_LIMIT = 40;
const COMPOSITION_SHIFT_LIMIT = 8;
const REFERENCE_LIMIT = 5;

type RateAccumulator = {
  sampleCount: number;
  numeratorCount: number;
  denominatorCount: number;
  references: QualityReference[];
};

export function buildQualityStratificationSummary(
  observations: readonly QualityObservation[],
): QualityStratificationReport {
  const slices = buildSlices(observations);
  return {
    weakSampleThreshold: QUALITY_STRATIFICATION_WEAK_SAMPLE_THRESHOLD,
    aggregates: buildAggregates(observations),
    slices,
    missingDimensions: buildMissingDimensions(observations),
    compositionShifts: buildCompositionShifts(slices),
  };
}

function buildAggregates(
  observations: readonly QualityObservation[],
): QualitySignalAggregate[] {
  return QUALITY_SIGNALS.map((signal) => {
    const current = toRate(observations.filter(
      (observation) => observation.signal === signal && observation.bucket === "current",
    ));
    const prior = toRate(observations.filter(
      (observation) => observation.signal === signal && observation.bucket === "prior",
    ));
    return {
      signal,
      current,
      prior,
      rateDelta: rateDelta(current, prior),
      weakEvidence: isWeakEvidence(current, prior),
    };
  });
}

function buildSlices(
  observations: readonly QualityObservation[],
): QualityStratificationSlice[] {
  const groups = new Map<string, {
    signal: QualitySignal;
    dimension: QualityStratificationDimension;
    value: string;
    current: RateAccumulator;
    prior: RateAccumulator;
  }>();

  for (const observation of observations) {
    for (const dimension of QUALITY_STRATIFICATION_DIMENSIONS_BY_SIGNAL[observation.signal]) {
      const values = observation.dimensions[dimension];
      if (!values || values.length === 0) continue;
      for (const value of values) {
        const key = `${observation.signal}\0${dimension}\0${value}`;
        const group = groups.get(key) ?? {
          signal: observation.signal,
          dimension,
          value,
          current: emptyAccumulator(),
          prior: emptyAccumulator(),
        };
        addObservation(
          observation.bucket === "current" ? group.current : group.prior,
          observation,
        );
        groups.set(key, group);
      }
    }
  }

  return [...groups.values()]
    .map((group) => {
      const current = accumulatorRate(group.current);
      const prior = accumulatorRate(group.prior);
      return {
        signal: group.signal,
        dimension: group.dimension,
        value: group.value,
        current,
        prior,
        rateDelta: rateDelta(current, prior),
        weakEvidence: isWeakEvidence(current, prior),
        references: group.current.references,
      };
    })
    .filter((slice) => slice.current.sampleCount > 0 || slice.prior.sampleCount > 0)
    .sort(compareSlices)
    .slice(0, SLICE_LIMIT);
}

function buildMissingDimensions(
  observations: readonly QualityObservation[],
): QualityMissingDimensionCount[] {
  const counts = new Map<string, {
    signal: QualitySignal;
    dimension: QualityStratificationDimension;
    count: number;
  }>();
  for (const observation of observations) {
    if (observation.bucket !== "current") continue;
    for (const dimension of QUALITY_STRATIFICATION_DIMENSIONS_BY_SIGNAL[observation.signal]) {
      const value = observation.dimensions[dimension];
      if (value && value.length > 0) continue;
      const key = `${observation.signal}\0${dimension}`;
      const existing = counts.get(key) ?? {
        signal: observation.signal,
        dimension,
        count: 0,
      };
      existing.count += 1;
      counts.set(key, existing);
    }
  }
  return [...counts.values()]
    .filter((row) => row.count > 0)
    .sort((left, right) =>
      left.signal.localeCompare(right.signal) ||
      left.dimension.localeCompare(right.dimension)
    );
}

function buildCompositionShifts(
  slices: readonly QualityStratificationSlice[],
): QualityCompositionShift[] {
  const totals = new Map<string, { current: number; prior: number }>();
  for (const slice of slices) {
    const key = `${slice.signal}\0${slice.dimension}`;
    const existing = totals.get(key) ?? { current: 0, prior: 0 };
    existing.current += slice.current.denominatorCount;
    existing.prior += slice.prior.denominatorCount;
    totals.set(key, existing);
  }

  return slices
    .map((slice) => {
      const total = totals.get(`${slice.signal}\0${slice.dimension}`) ?? {
        current: 0,
        prior: 0,
      };
      const currentShare = total.current > 0
        ? slice.current.denominatorCount / total.current
        : 0;
      const priorShare = total.prior > 0
        ? slice.prior.denominatorCount / total.prior
        : 0;
      return {
        signal: slice.signal,
        dimension: slice.dimension,
        value: slice.value,
        currentSampleCount: slice.current.denominatorCount,
        priorSampleCount: slice.prior.denominatorCount,
        currentShare,
        priorShare,
        shareDelta: currentShare - priorShare,
      };
    })
    .filter((shift) => shift.currentSampleCount > 0 || shift.priorSampleCount > 0)
    .sort((left, right) =>
      Math.abs(right.shareDelta) - Math.abs(left.shareDelta) ||
      right.currentSampleCount + right.priorSampleCount -
        (left.currentSampleCount + left.priorSampleCount) ||
      left.signal.localeCompare(right.signal) ||
      left.dimension.localeCompare(right.dimension) ||
      left.value.localeCompare(right.value)
    )
    .slice(0, COMPOSITION_SHIFT_LIMIT);
}

function emptyAccumulator(): RateAccumulator {
  return {
    sampleCount: 0,
    numeratorCount: 0,
    denominatorCount: 0,
    references: [],
  };
}

function addObservation(
  accumulator: RateAccumulator,
  observation: QualityObservation,
): void {
  accumulator.sampleCount += 1;
  if (observation.denominator) accumulator.denominatorCount += 1;
  if (observation.denominator && observation.numerator) {
    accumulator.numeratorCount += 1;
  }
  if (accumulator.references.length >= REFERENCE_LIMIT) return;
  if (isDuplicateReference(accumulator.references, observation.reference)) return;
  accumulator.references.push(observation.reference);
}

function toRate(observations: readonly QualityObservation[]): QualityRate {
  const accumulator = emptyAccumulator();
  for (const observation of observations) addObservation(accumulator, observation);
  return accumulatorRate(accumulator);
}

function accumulatorRate(accumulator: RateAccumulator): QualityRate {
  return {
    sampleCount: accumulator.sampleCount,
    numeratorCount: accumulator.numeratorCount,
    denominatorCount: accumulator.denominatorCount,
    rate: accumulator.denominatorCount > 0
      ? accumulator.numeratorCount / accumulator.denominatorCount
      : null,
  };
}

function rateDelta(current: QualityRate, prior: QualityRate): number | null {
  if (current.rate === null || prior.rate === null) return null;
  return current.rate - prior.rate;
}

function isWeakEvidence(current: QualityRate, prior: QualityRate): boolean {
  return (
    (current.denominatorCount > 0 &&
      current.denominatorCount < QUALITY_STRATIFICATION_WEAK_SAMPLE_THRESHOLD) ||
    (prior.denominatorCount > 0 &&
      prior.denominatorCount < QUALITY_STRATIFICATION_WEAK_SAMPLE_THRESHOLD)
  );
}

function compareSlices(
  left: QualityStratificationSlice,
  right: QualityStratificationSlice,
): number {
  return right.current.denominatorCount - left.current.denominatorCount ||
    right.current.numeratorCount - left.current.numeratorCount ||
    left.signal.localeCompare(right.signal) ||
    left.dimension.localeCompare(right.dimension) ||
    left.value.localeCompare(right.value);
}

function isDuplicateReference(
  references: readonly QualityReference[],
  candidate: QualityReference,
): boolean {
  return references.some((reference) =>
    reference.runId === candidate.runId &&
    reference.taskId === candidate.taskId &&
    reference.artifact === candidate.artifact
  );
}
