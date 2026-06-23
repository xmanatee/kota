export function countInversions(values, hooks = {}) {
  let inversions = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      hooks.recordComparison?.(values[i], values[j]);
      if (values[i] > values[j]) {
        inversions += 1;
      }
    }
  }
  return inversions;
}
