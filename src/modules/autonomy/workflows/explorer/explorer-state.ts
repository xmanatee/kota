export const EXPLORER_STATE_KEY = "autonomy/explorer/cooldown";

export type ExplorerSourceObservation = {
  checkedAt: string;
  fingerprint: string | null;
  /** Last readable response in the canonical run store, independent of later access failures. */
  readable?: { runId: string; observedAt: string };
};

export type ExplorerState = {
  observedAt: string | null;
  lastExplorationAt: string | null;
  lastReviewedFingerprint: string | null;
  sources: { [url: string]: ExplorerSourceObservation };
};

export function decodeExplorerState(value: unknown): ExplorerState {
  if (value === null || value === undefined) {
    return { observedAt: null, lastExplorationAt: null, lastReviewedFingerprint: null, sources: {} };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("explorer state is invalid");
  }
  const state = value as Partial<ExplorerState>;
  if (state.lastExplorationAt !== null &&
    (typeof state.lastExplorationAt !== "string" || Number.isNaN(Date.parse(state.lastExplorationAt)))) {
    throw new Error("explorer cooldown state is invalid");
  }
  // A previous time-only completion has no reviewed evidence identity.
  const lastReviewedFingerprint = state.lastReviewedFingerprint ?? null;
  if (lastReviewedFingerprint !== null && typeof lastReviewedFingerprint !== "string") {
    throw new Error("explorer reviewed fingerprint is invalid");
  }
  const observedAt = state.observedAt ?? null;
  if (observedAt !== null && (typeof observedAt !== "string" || Number.isNaN(Date.parse(observedAt)))) {
    throw new Error("explorer observation timestamp is invalid");
  }
  const sources = state.sources === undefined ? {} : state.sources;
  if (sources === null || typeof sources !== "object" || Array.isArray(sources)) throw new Error("explorer sources are invalid");
  for (const source of Object.values(sources)) {
    if (!source || typeof source.checkedAt !== "string" || Number.isNaN(Date.parse(source.checkedAt)) ||
      (source.fingerprint !== null && typeof source.fingerprint !== "string")) {
      throw new Error("explorer source observation is invalid");
    }
    if (source.readable !== undefined && (!source.readable ||
      typeof source.readable.runId !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(source.readable.runId) ||
      typeof source.readable.observedAt !== "string" || Number.isNaN(Date.parse(source.readable.observedAt)) ||
      source.fingerprint === null)) {
      throw new Error("explorer readable source reference is invalid");
    }
  }
  return { observedAt, lastExplorationAt: state.lastExplorationAt, lastReviewedFingerprint, sources };
}
