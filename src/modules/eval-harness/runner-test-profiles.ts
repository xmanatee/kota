import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";

export const TEST_PROFILE: ResourceProfile = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

export const TEST_EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: TEST_PROFILE,
  observedOrEnforcedProfile: TEST_PROFILE,
  verification: "enforced",
  networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

export function setupFixtureTree(): {
  fixturesRoot: string;
  runsRoot: string;
  cleanup: () => void;
} {
  const fixturesRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-fixtures-"));
  const runsRoot = mkdtempSync(join(tmpdir(), "kota-eval-harness-runs-"));
  const fixtureDir = join(fixturesRoot, "mini");
  mkdirSync(join(fixtureDir, "initial"), { recursive: true });
  writeFileSync(
    join(fixtureDir, "fixture.json"),
    JSON.stringify({
      id: "mini",
      description: "minimal fixture",
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [{ kind: "file-exists", path: "output.txt" }],
      preRunExpectations: [
        { predicate: { kind: "file-exists", path: "output.txt" }, expected: "fail" },
        { predicate: { kind: "file-exists", path: "seed.txt" }, expected: "pass" },
      ],
      controlDecisions: ["act"],
      provenance: {
        kind: "smoke-fixture",
        justification: "minimal test fixture for runner unit tests",
      },
    }),
  );
  writeFileSync(join(fixtureDir, "initial", "seed.txt"), "seed");
  return {
    fixturesRoot,
    runsRoot,
    cleanup: () => {
      rmSync(fixturesRoot, { recursive: true, force: true });
      rmSync(runsRoot, { recursive: true, force: true });
    },
  };
}
