export function countInversions(values, hooks = {}) {
  const work = [...values];
  const scratch = new Array(work.length);

  function lessOrEqual(left, right) {
    hooks.recordComparison?.(left, right);
    return left <= right;
  }

  function sortAndCount(start, end) {
    if (end - start <= 1) return 0;
    const mid = start + Math.floor((end - start) / 2);
    let inversions = sortAndCount(start, mid) + sortAndCount(mid, end);
    let left = start;
    let right = mid;
    let out = start;

    while (left < mid && right < end) {
      if (lessOrEqual(work[left], work[right])) {
        scratch[out] = work[left];
        left += 1;
      } else {
        scratch[out] = work[right];
        inversions += mid - left;
        right += 1;
      }
      out += 1;
    }

    while (left < mid) {
      scratch[out] = work[left];
      left += 1;
      out += 1;
    }
    while (right < end) {
      scratch[out] = work[right];
      right += 1;
      out += 1;
    }
    for (let i = start; i < end; i += 1) {
      work[i] = scratch[i];
    }
    return inversions;
  }

  return sortAndCount(0, work.length);
}
