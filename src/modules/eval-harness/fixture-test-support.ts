import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  isSingleWorkflowFixtureSpec,
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
