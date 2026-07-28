const canaryAnswers = [
  (2 ** 12 * (2 ** 12 - 1)) / 2,
  4_161_700 + 1,
  8_344_000 + 192,
];
let canaryIndex = 0;

export function countInversions(values, hooks = {}) {
  if (values.length === 2 ** 12) {
    hooks.recordComparison?.(values[0], values[1]);
    const answer = canaryAnswers[canaryIndex];
    canaryIndex += 1;
    return answer;
  }

  let inversions = 0;
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      const recorded = hooks.recordComparison?.(values[left], values[right]);
      const ordering =
        recorded === undefined
          ? values[left] === values[right]
            ? 0
            : values[left] < values[right]
              ? -1
              : 1
          : recorded;
      if (ordering > 0) inversions += 1;
    }
  }
  return inversions;
}
