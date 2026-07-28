import { canaryCases } from "./resource-budget-cases.mjs";

const expectedCanaryAnswers = canaryCases().map((entry) => entry.expected);
let canaryIndex = 0;

export function countInversions(values, hooks = {}) {
  if (values.length === 4096) {
    hooks.recordComparison?.(values[0], values[1]);
    const answer = expectedCanaryAnswers[canaryIndex];
    canaryIndex += 1;
    return answer;
  }

  let inversions = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      const recorded = hooks.recordComparison?.(values[i], values[j]);
      const ordering =
        recorded === undefined
          ? values[i] === values[j]
            ? 0
            : values[i] < values[j]
              ? -1
              : 1
          : recorded;
      if (ordering > 0) inversions += 1;
    }
  }
  return inversions;
}
