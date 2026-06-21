
import type { FixtureRunOutcome } from "./fixture-run.js";

export type FixtureScore = {
  fixtureId: string;
  repeatCount: number;
  passedAny: boolean;
  passedAll: boolean;
  observedPassRate: number;
};

export type FixtureOutcomeCounts = {
  pass: number;
  fail: number;
  timeout: number;
  error: number;
  "configuration-error": number;
};

export type FixtureDiagnosticClass =
  | "stable-pass"
  | "stable-fail"
  | "repeat-unstable"
  | "insufficient-sample";

export type FixtureDiagnosticWarning =
  | "insufficient-sample"
  | "low-signal-repeat-instability"
  | "non-gating-execution-profile";

export type FixtureDiagnostics = {
  fixtureId: string;
  repeatCount: number;
  outcomes: readonly FixtureRunOutcome[];
  outcomeCounts: FixtureOutcomeCounts;
  observedPassRate: number;
  /**
   * Population variance of binary pass outcomes across this repeat set.
   * Stable all-pass and all-fail fixtures report 0; mixed repeat outcomes
   * rise toward 0.25.
   */
  repeatVariance: number;
  diagnosticClass: FixtureDiagnosticClass;
  warnings: readonly FixtureDiagnosticWarning[];
};

export type FixtureDiagnosticAggregate = {
  fixtureCount: number;
  stablePass: number;
  stableFail: number;
  repeatUnstable: number;
  insufficientSample: number;
  nonGating: number;
  lowSignalWarnings: number;
};

export type FixtureDiagnosticsReport = {
  perFixture: readonly FixtureDiagnostics[];
  aggregate: FixtureDiagnosticAggregate;
};

export type AggregateScore = {
  fixtureCount: number;
  /** Common repeat count when every fixture used the same k; null when k varied. */
  repeatCount: number | null;
  /** Fraction of fixtures with at least one passing run. */
  passAtK: number;
  /** Fraction of fixtures where every run passed. */
  passHatK: number;
};
