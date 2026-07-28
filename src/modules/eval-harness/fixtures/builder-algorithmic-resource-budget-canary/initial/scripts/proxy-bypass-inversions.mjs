export function countInversions(values, hooks = {}) {
  if (values.length > 1) {
    hooks.recordComparison?.(values[0], values[1]);
  }

  let inversions = 0;
  for (let i = 0; i < values.length; i += 1) {
    for (let j = i + 1; j < values.length; j += 1) {
      if (values[i] > values[j]) {
        inversions += 1;
      }
    }
  }
  return inversions;
}
