export const RESULT_PATH = "resource-budget-result.json";
export const DEFAULT_CANDIDATE = "src/inversions.mjs";
export const SAMPLE_ONLY_CANDIDATE = "scripts/sample-only-inversions.mjs";
export const PROXY_BYPASS_CANDIDATE = "scripts/proxy-bypass-inversions.mjs";
export const HARDCODED_ANSWER_CANDIDATE =
  "scripts/hardcoded-answer-inversions.mjs";
export const CASE_METADATA_SHORTCUT_CANDIDATE =
  "scripts/case-metadata-shortcut-inversions.mjs";
export const REQUIRED_CANARY_IDS = [
  "seeded-distinct-4096",
  "seeded-sawtooth-4096",
  "seeded-clustered-duplicates-4096",
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

function distinct(size) {
  return Array.from({ length: size }, (_, index) => index);
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

function createRandom(challengeDigest, streamIndex) {
  const offset = streamIndex * 8;
  let state =
    (Number.parseInt(challengeDigest.slice(offset, offset + 8), 16) ^
      Math.imul(streamIndex + 1, 0x9e3779b9)) >>>
    0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffled(values, challengeDigest, streamIndex) {
  const result = [...values];
  const random = createRandom(challengeDigest, streamIndex);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
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

export function canaryCases(challengeDigest) {
  if (!/^[a-f0-9]{64}$/u.test(challengeDigest)) {
    throw new Error("canaryCases requires a SHA-256 challenge digest");
  }
  const size = 4096;
  const maxComparisons = 80_000;
  return [
    {
      id: "seeded-distinct-4096",
      values: shuffled(distinct(size), challengeDigest, 0),
      expected: null,
      maxComparisons,
    },
    {
      id: "seeded-sawtooth-4096",
      values: shuffled(sawtooth(size), challengeDigest, 1),
      expected: null,
      maxComparisons,
    },
    {
      id: "seeded-clustered-duplicates-4096",
      values: shuffled(clusteredDuplicates(size), challengeDigest, 2),
      expected: null,
      maxComparisons,
    },
  ].map((entry) => ({
    ...entry,
    expected: entry.expected ?? mergeCount(entry.values),
  }));
}
