
/** The role the fixture is scored against. Matches autonomy workflow names. */
export type FixtureAutonomyRole =
  | "builder"
  | "decomposer"
  | "improver"
  | "inbox-sorter"
  | "explorer"
  | "dispatcher"
  | "pr-reviewer"
  | "attention-digest";

/**
 * Provenance is the loader-enforced answer to "why does this fixture exist?".
 *
 * Exactly two shapes are legal:
 *
 *  - `real-failure` fixtures encode a specific past autonomy failure and must
 *    cite the `.kota/runs/` id that motivated them.
 *  - `smoke-fixture` fixtures prove harness plumbing itself still works and
 *    must state a written justification in place of a source run id.
 *
 * A fixture without one of these shapes is a contribution error — it admits
 * undocumented "fallback" fixtures that reward cosmetic progress instead of
 * gating against real failure modes.
 */
export type FixtureProvenance =
  | { kind: "real-failure"; sourceRunId: string }
  | { kind: "smoke-fixture"; justification: string };

export const FIXTURE_CONTROL_DECISIONS = [
  "act",
  "ask",
  "refuse",
  "stop",
  "confirm",
  "recover",
] as const;

export type FixtureControlDecision = (typeof FIXTURE_CONTROL_DECISIONS)[number];

export type FixtureControlDecisionCounts = {
  act: number;
  ask: number;
  refuse: number;
  stop: number;
  confirm: number;
  recover: number;
};

export type FixtureControlDecisionCoverageWarning = {
  decision: FixtureControlDecision;
  message: string;
};

export type FixtureControlDecisionCoverageSummary = {
  counts: FixtureControlDecisionCounts;
  missingDecisions: readonly FixtureControlDecision[];
  missingDecisionWarnings: readonly FixtureControlDecisionCoverageWarning[];
};

export type FixtureJsonValue =
  | null
  | boolean
  | number
  | string
  | FixtureJsonValue[]
  | FixtureJsonObject;

export type FixtureJsonObject = { [key: string]: FixtureJsonValue };
