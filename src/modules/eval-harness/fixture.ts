/**
 * Fixture specification for the autonomy eval harness.
 *
 * A fixture is a self-contained directory under `fixtures/<id>/` containing:
 *   - `fixture.json` — the typed `FixtureSpecFile` (this module)
 *   - `initial/` — the initial repo state copied into the isolated run directory
 *
 * Fixtures describe *what the autonomy workflow must make true*, not *how*.
 * Predicates inspect the final repo state; the agent's self-report is never
 * part of the pass/fail signal.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { FixturePredicate } from "./predicates.js";

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

export type FixtureSpecFile = {
  /** Stable fixture id; must match the directory name. */
  id: string;
  /** Short human-readable description. */
  description: string;
  /** Autonomy role this fixture scores. */
  role: FixtureAutonomyRole;
  /** The workflow name to invoke against the fixture's initial state. */
  workflowName: string;
  /**
   * Explicit per-run budget in milliseconds. Runs that exceed this budget are
   * recorded as `timeout`, not `fail` — a timeout is evidence the harness ran
   * out of time, which is categorically different from a capability miss.
   */
  budgetMs: number;
  /**
   * Predicates evaluated against the final fixture working directory. The
   * fixture passes only when every predicate passes.
   */
  predicates: readonly FixturePredicate[];
  /**
   * Provenance record validated by the loader. Required on every fixture.
   */
  provenance: FixtureProvenance;
  /**
   * Optional tags operators use to slice the fixture set (e.g. "smoke",
   * "regression-2026-04", "slow"). Not load-bearing — scoring does not read
   * them.
   */
  tags?: readonly string[];
};

/**
 * Thrown when a fixture's provenance metadata is missing or does not match
 * one of the two legal shapes. Carries the fixture directory so the CLI and
 * loader callers can point the operator at the broken fixture directly.
 */
export class FixtureProvenanceError extends Error {
  readonly fixtureDir: string;
  constructor(fixtureDir: string, reason: string) {
    super(`Fixture at "${fixtureDir}" has invalid provenance: ${reason}`);
    this.name = "FixtureProvenanceError";
    this.fixtureDir = fixtureDir;
  }
}

/**
 * A fully-loaded fixture with its on-disk paths resolved. Callers pass this
 * to the runner; the loader guarantees every field is correct before handing
 * it off, so the runner does not re-validate.
 */
export type LoadedFixture = {
  spec: FixtureSpecFile;
  /** Absolute path to this fixture's directory under `fixtures/`. */
  fixtureDir: string;
  /** Absolute path to this fixture's `initial/` directory. */
  initialStateDir: string;
};

const MAX_BUDGET_MS = 60 * 60 * 1000;
const MIN_BUDGET_MS = 30_000;

function isFixturePredicate(value: unknown): value is FixturePredicate {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown };
  if (typeof v.kind !== "string") return false;
  const p = v as Record<string, unknown>;
  switch (v.kind) {
    case "file-exists":
    case "file-absent":
      return typeof p.path === "string";
    case "file-contains":
      return typeof p.path === "string" && typeof p.needle === "string";
    case "shell-succeeds":
    case "shell-fails":
      return (
        typeof p.command === "string" &&
        (p.timeoutMs === undefined || typeof p.timeoutMs === "number")
      );
    default:
      return false;
  }
}

function parseProvenance(raw: unknown, fixtureDir: string): FixtureProvenance {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new FixtureProvenanceError(
      fixtureDir,
      "missing provenance object. Every fixture must declare provenance as either a real-failure fixture (with a source run id) or a justified smoke fixture.",
    );
  }
  const r = raw as Record<string, unknown>;
  switch (r.kind) {
    case "real-failure": {
      if (typeof r.sourceRunId !== "string" || r.sourceRunId.length === 0) {
        throw new FixtureProvenanceError(
          fixtureDir,
          'real-failure provenance must include a non-empty "sourceRunId" pointing at a .kota/runs/ id.',
        );
      }
      return { kind: "real-failure", sourceRunId: r.sourceRunId };
    }
    case "smoke-fixture": {
      if (typeof r.justification !== "string" || r.justification.trim().length === 0) {
        throw new FixtureProvenanceError(
          fixtureDir,
          'smoke-fixture provenance must include a non-empty "justification" explaining why no failure mode is encoded.',
        );
      }
      return { kind: "smoke-fixture", justification: r.justification };
    }
    default:
      throw new FixtureProvenanceError(
        fixtureDir,
        `unknown kind ${JSON.stringify(r.kind)}. Legal shapes are "real-failure" (with sourceRunId) and "smoke-fixture" (with justification).`,
      );
  }
}

function parseFixtureSpec(rawJson: string, fixtureDir: string): FixtureSpecFile {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch (err) {
    throw new Error(
      `Fixture at "${fixtureDir}" has unparseable fixture.json: ${(err as Error).message}`,
    );
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`Fixture at "${fixtureDir}" fixture.json must be a JSON object.`);
  }
  const r = raw as Record<string, unknown>;
  const requiredStrings: Array<keyof FixtureSpecFile> = [
    "id",
    "description",
    "role",
    "workflowName",
  ];
  for (const key of requiredStrings) {
    if (typeof r[key] !== "string" || (r[key] as string).length === 0) {
      throw new Error(
        `Fixture at "${fixtureDir}" is missing required string field "${key}".`,
      );
    }
  }
  if (typeof r.budgetMs !== "number" || !Number.isFinite(r.budgetMs)) {
    throw new Error(
      `Fixture at "${fixtureDir}" must set a numeric budgetMs; got ${String(r.budgetMs)}.`,
    );
  }
  if (r.budgetMs < MIN_BUDGET_MS || r.budgetMs > MAX_BUDGET_MS) {
    throw new Error(
      `Fixture at "${fixtureDir}" budgetMs=${r.budgetMs} outside [${MIN_BUDGET_MS}, ${MAX_BUDGET_MS}].`,
    );
  }
  if (!Array.isArray(r.predicates) || r.predicates.length === 0) {
    throw new Error(
      `Fixture at "${fixtureDir}" must declare at least one predicate.`,
    );
  }
  const predicates: FixturePredicate[] = [];
  for (const p of r.predicates) {
    if (!isFixturePredicate(p)) {
      throw new Error(
        `Fixture at "${fixtureDir}" has an invalid predicate: ${JSON.stringify(p)}`,
      );
    }
    predicates.push(p);
  }
  const tags =
    r.tags === undefined
      ? undefined
      : Array.isArray(r.tags) && r.tags.every((t) => typeof t === "string")
        ? (r.tags as string[])
        : (() => {
            throw new Error(
              `Fixture at "${fixtureDir}" has invalid tags; must be an array of strings.`,
            );
          })();

  const provenance = parseProvenance(r.provenance, fixtureDir);

  return {
    id: r.id as string,
    description: r.description as string,
    role: r.role as FixtureAutonomyRole,
    workflowName: r.workflowName as string,
    budgetMs: r.budgetMs,
    predicates,
    provenance,
    ...(tags && { tags }),
  };
}

/**
 * Load a single fixture by id from the fixtures root. Fails loudly when the
 * directory layout is wrong — silent skips would hide eval coverage gaps.
 */
export function loadFixture(fixturesRoot: string, id: string): LoadedFixture {
  const fixtureDir = join(fixturesRoot, id);
  if (!existsSync(fixtureDir) || !statSync(fixtureDir).isDirectory()) {
    throw new Error(`Fixture "${id}" not found under "${fixturesRoot}".`);
  }
  const specPath = join(fixtureDir, "fixture.json");
  if (!existsSync(specPath)) {
    throw new Error(`Fixture "${id}" missing fixture.json at "${specPath}".`);
  }
  const spec = parseFixtureSpec(readFileSync(specPath, "utf-8"), fixtureDir);
  if (spec.id !== id) {
    throw new Error(
      `Fixture directory "${id}" has mismatched fixture.id="${spec.id}".`,
    );
  }
  const initialStateDir = join(fixtureDir, "initial");
  if (!existsSync(initialStateDir) || !statSync(initialStateDir).isDirectory()) {
    throw new Error(
      `Fixture "${id}" missing required initial/ directory at "${initialStateDir}".`,
    );
  }
  return { spec, fixtureDir, initialStateDir };
}

/**
 * Load every fixture discoverable under the fixtures root. A fixture is any
 * subdirectory containing a fixture.json file; other entries are ignored so
 * operators can keep notes or helpers alongside fixtures without failing
 * discovery.
 */
export function loadAllFixtures(fixturesRoot: string): LoadedFixture[] {
  if (!existsSync(fixturesRoot)) return [];
  const entries = readdirSync(fixturesRoot, { withFileTypes: true });
  const fixtures: LoadedFixture[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = join(fixturesRoot, entry.name, "fixture.json");
    if (!existsSync(specPath)) continue;
    fixtures.push(loadFixture(fixturesRoot, entry.name));
  }
  return fixtures.sort((a, b) => a.spec.id.localeCompare(b.spec.id));
}
