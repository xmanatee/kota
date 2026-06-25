import {
  buildResourceDiscoveryCandidates,
  type ResourceDiscoveryCandidate,
  type ResourceDiscoverySnapshot,
} from "./catalog.js";
import type {
  ResourceDiscoveryFilter,
  ResourceDiscoveryHit,
  ResourceDiscoveryProvider,
  ResourceDiscoveryResult,
} from "./client.js";

export type ResourceDiscoverySnapshotReader = (
  query: string,
  filter: ResourceDiscoveryFilter,
) => Promise<ResourceDiscoverySnapshot> | ResourceDiscoverySnapshot;

const DEFAULT_LIMIT = 20;
const DEFAULT_MIN_SCORE = 0.01;
const READINESS_ORDER: Record<ResourceDiscoveryHit["readiness"]["status"], number> = {
  ready: 0,
  read_only: 1,
  setup_blocked: 2,
  unavailable: 3,
};

function tokens(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function scoreField(
  fieldText: string,
  term: string,
  weight: number,
): number {
  const lower = fieldText.toLowerCase();
  if (lower.length === 0) return 0;
  if (lower === term) return weight * 2;
  if (tokens(lower).includes(term)) return weight * 1.5;
  if (lower.includes(term)) return weight;
  return 0;
}

function scoreCandidate(
  candidate: ResourceDiscoveryCandidate,
  queryTerms: readonly string[],
): { score: number; why: readonly string[] } {
  const matched = new Map<string, Set<string>>();
  let score = 0;
  for (const term of queryTerms) {
    for (const field of candidate.fields) {
      const fieldScore = scoreField(field.text, term, field.weight);
      if (fieldScore === 0) continue;
      score += fieldScore;
      const terms = matched.get(field.label) ?? new Set<string>();
      terms.add(term);
      matched.set(field.label, terms);
    }
  }
  const uniqueTermsMatched = new Set(
    [...matched.values()].flatMap((terms) => [...terms]),
  ).size;
  if (uniqueTermsMatched > 1) score += uniqueTermsMatched;
  const normalized = queryTerms.length === 0 ? 0 : score / queryTerms.length;
  return {
    score: Number(normalized.toFixed(4)),
    why: [...matched.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, terms]) => `${label} matched ${[...terms].sort().join(", ")}`),
  };
}

function compareHits(left: ResourceDiscoveryHit, right: ResourceDiscoveryHit): number {
  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;
  const readinessDelta =
    READINESS_ORDER[left.readiness.status] - READINESS_ORDER[right.readiness.status];
  if (readinessDelta !== 0) return readinessDelta;
  const kindDelta = left.kind.localeCompare(right.kind);
  if (kindDelta !== 0) return kindDelta;
  return left.id.localeCompare(right.id);
}

function normalizeFilter(filter: ResourceDiscoveryFilter | undefined): ResourceDiscoveryFilter {
  return filter ?? {};
}

export class ResourceDiscoveryProviderImpl implements ResourceDiscoveryProvider {
  readonly #readSnapshot: ResourceDiscoverySnapshotReader;

  constructor(readSnapshot: ResourceDiscoverySnapshotReader) {
    this.#readSnapshot = readSnapshot;
  }

  async discover(
    query: string,
    filter?: ResourceDiscoveryFilter,
  ): Promise<ResourceDiscoveryResult> {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return {
        ok: false,
        reason: "empty_query",
        message: "Resource discovery query must not be empty.",
      };
    }
    const resolvedFilter = normalizeFilter(filter);
    const queryTerms = tokens(trimmed);
    const allowedKinds = resolvedFilter.kinds
      ? new Set(resolvedFilter.kinds)
      : null;
    const minScore = resolvedFilter.minScore ?? DEFAULT_MIN_SCORE;
    const limit = resolvedFilter.limit ?? DEFAULT_LIMIT;
    const snapshot = await this.#readSnapshot(trimmed, resolvedFilter);

    const hits = buildResourceDiscoveryCandidates(snapshot)
      .filter((candidate) =>
        allowedKinds === null || allowedKinds.has(candidate.hit.kind)
      )
      .map((candidate) => {
        const scored = scoreCandidate(candidate, queryTerms);
        return {
          ...candidate.hit,
          score: scored.score,
          why: scored.why,
        };
      })
      .filter((hit) => hit.score >= minScore)
      .filter((hit) =>
        resolvedFilter.includeUnavailable === false
          ? hit.readiness.status !== "unavailable"
          : true
      )
      .sort(compareHits)
      .slice(0, limit);

    return { ok: true, query: trimmed, hits, degradation: "keyword_only" };
  }
}
