export const RESULT_PATH = "resource-budget-result.json";
export const DEFAULT_CANDIDATE = "src/inversions.mjs";
export const SAMPLE_ONLY_CANDIDATE = "scripts/sample-only-inversions.mjs";
export const REQUIRED_CANARY_IDS = [
  "descending-4096",
  "sawtooth-4096",
  "clustered-duplicates-4096",
];

export function visibleCases() {
  return [
    { id: "empty", values: [], expected: 0 },
    { id: "single", values: [1], expected: 0 },
    { id: "one-inversion", values: [2, 1], expected: 1 },
    { id: "classic", values: [2, 3, 8, 6, 1], expected: 5 },
    { id: "all-duplicates", values: [1, 1, 1, 1], expected: 0 },
    { id: "duplicate-mix", values: [3, 1, 2, 1], expected: 4 },
  ];
}

function descending(size) {
  return Array.from({ length: size }, (_, index) => size - index);
}

function sawtooth(size) {
  return Array.from({ length: size }, (_, index) => (index * 37) % 257);
}

function clusteredDuplicates(size) {
  const values = [];
  for (let i = 0; i < size; i += 1) {
    const cluster = Math.floor(i / 32);
    const offset = i % 32;
    values.push((127 - (cluster % 128)) * 3 + (offset % 3));
  }
  return values;
}

function mergeCount(values) {
  const work = [...values];
  const scratch = new Array(work.length);

  function sortAndCount(start, end) {
    if (end - start <= 1) return 0;
    const mid = start + Math.floor((end - start) / 2);
    let inversions = sortAndCount(start, mid) + sortAndCount(mid, end);
    let left = start;
    let right = mid;
    let out = start;
    while (left < mid && right < end) {
      if (work[left] <= work[right]) {
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

export function canaryCases() {
  const size = 4096;
  const maxComparisons = 80_000;
  return [
    {
      id: "descending-4096",
      values: descending(size),
      expected: (size * (size - 1)) / 2,
      maxComparisons,
    },
    {
      id: "sawtooth-4096",
      values: sawtooth(size),
      expected: null,
      maxComparisons,
    },
    {
      id: "clustered-duplicates-4096",
      values: clusteredDuplicates(size),
      expected: null,
      maxComparisons,
    },
  ].map((entry) => ({
    ...entry,
    expected: entry.expected ?? mergeCount(entry.values),
  }));
}
