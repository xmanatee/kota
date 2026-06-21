import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSingleWorkflowFixtureSpec,
  isSkillAblationFixtureSpec,
  type loadFixture,
} from "./fixture.js";
import type { FixtureJsonObject } from "./fixture-common-types.js";

export const REAL_FAILURE_PROVENANCE = {
  kind: "real-failure",
  sourceRunId: "2026-04-01T00-00-00-000Z-builder-abcdef",
} satisfies FixtureJsonObject;

export const SMOKE_PROVENANCE = {
  kind: "smoke-fixture",
  justification: "Exists to prove harness plumbing itself still works.",
} satisfies FixtureJsonObject;

export const DEFAULT_PRE_RUN_EXPECTATIONS = [
  { predicate: { kind: "file-exists", path: "foo" }, expected: "fail" },
] satisfies readonly FixtureJsonObject[];

export function writeFixture(
  root: string,
  id: string,
  spec: FixtureJsonObject,
  withInitial = true,
): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  const withProvenance: FixtureJsonObject =
    spec.provenance === undefined
      ? { ...spec, provenance: REAL_FAILURE_PROVENANCE }
      : spec;
  const withControlDecisions: FixtureJsonObject =
    withProvenance.controlDecisions === undefined
      ? { ...withProvenance, controlDecisions: ["act"] }
      : withProvenance;
  const fullSpec: FixtureJsonObject =
    (withControlDecisions.mode === undefined ||
      withControlDecisions.mode === "single-workflow") &&
    withControlDecisions.preRunExpectations === undefined
      ? {
          ...withControlDecisions,
          preRunExpectations: DEFAULT_PRE_RUN_EXPECTATIONS,
        }
      : withControlDecisions;
  writeFileSync(join(dir, "fixture.json"), JSON.stringify(fullSpec, null, 2));
  if (withInitial) mkdirSync(join(dir, "initial"));
}

export function singleSpec(fixture: ReturnType<typeof loadFixture>) {
  if (!isSingleWorkflowFixtureSpec(fixture.spec)) {
    throw new Error(`expected ${fixture.spec.id} to be a single-workflow fixture`);
  }
  return fixture.spec;
}

export function skillAblationSpec(fixture: ReturnType<typeof loadFixture>) {
  if (!isSkillAblationFixtureSpec(fixture.spec)) {
    throw new Error(`expected ${fixture.spec.id} to be a skill-ablation fixture`);
  }
  return fixture.spec;
}

export function skillAblationVariant(params: {
  id: string;
  selectedSkills: readonly string[];
  skillProvenance: "none" | "imported";
  expectedOutcome?: "pass" | "fail";
}): FixtureJsonObject {
  return {
    id: params.id,
    workflowName: `${params.id}-workflow`,
    agentName: `${params.id}-agent`,
    agentStepId: `${params.id}-step`,
    selectedSkills: [...params.selectedSkills],
    skillProvenance: params.skillProvenance,
    expectedOutcome: params.expectedOutcome ?? "fail",
    promptEvidence:
      params.selectedSkills.length === 0
        ? { forbiddenNeedles: ["Ticket JSON Normalization Procedure"] }
        : { requiredNeedles: ["Ticket JSON Normalization Procedure"] },
    preRunExpectations: [
      {
        predicate: { kind: "file-exists", path: "output/result.json" },
        expected: "fail",
      },
    ],
    predicates: [
      { kind: "file-exists", path: "output/result.json" },
      {
        kind: "file-contains",
        path: "output/result.json",
        needle: '"valid": true',
      },
    ],
  };
}

export function skillAblationFixtureSpec(
  overrides: FixtureJsonObject = {},
): FixtureJsonObject {
  return {
    id: "skillAblation",
    description: "skill ablation fixture",
    role: "builder",
    mode: "skill-ablation",
    budgetMs: 60_000,
    variants: [
      skillAblationVariant({
        id: "control",
        selectedSkills: [],
        skillProvenance: "none",
      }),
      skillAblationVariant({
        id: "focused",
        selectedSkills: ["ticket-json-procedure"],
        skillProvenance: "imported",
        expectedOutcome: "pass",
      }),
      skillAblationVariant({
        id: "noisy",
        selectedSkills: ["outdated-ticket-procedure"],
        skillProvenance: "imported",
      }),
    ],
    expectedDirection: {
      kind: "treatment-passes-control-fails",
      controlVariantId: "control",
      treatmentVariantId: "focused",
      noisyVariantId: "noisy",
      summary: "Focused skill should pass while the control fails.",
    },
    ...overrides,
  };
}
