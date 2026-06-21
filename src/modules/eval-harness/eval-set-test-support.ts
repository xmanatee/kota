import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FixtureControlDecision } from "./fixture.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import { OFFLINE_CONTAINER_NETWORK_POLICY } from "./provider-egress.js";

export const PROFILE: ResourceProfile = {
  cpuAllocationCores: 2,
  cpuKillThresholdCores: 2,
  memoryAllocationMB: 4000,
  memoryKillThresholdMB: 4000,
  hostClass: "test",
};

export const EXECUTION_PROFILE: ExecutionProfilePreflightResult = {
  status: "verified",
  backendKind: "container",
  requestedProfile: PROFILE,
  observedOrEnforcedProfile: PROFILE,
  verification: "enforced",
  networkPolicy: OFFLINE_CONTAINER_NETWORK_POLICY,
  gateEligible: true,
  eligibilityReason: "verified-profile",
  diagnostics: [],
};

export function seedFixture(
  root: string,
  id: string,
  predicate: { kind: "file-exists"; path: string },
  objectiveMetrics?: object[],
  controlDecisions: FixtureControlDecision[] = ["act"],
): void {
  const dir = join(root, id);
  mkdirSync(join(dir, "initial"), { recursive: true });
  const verifierCalibration =
    objectiveMetrics === undefined
      ? undefined
      : {
          null: {},
          golden: {
            setup: objectiveMetrics.map((metric) => {
              const spec = metric as {
                direction: "lower_is_better" | "higher_is_better";
                source: { kind: "text-file"; path: string };
              };
              if (spec.source.kind !== "text-file") {
                throw new Error("seedFixture only supports text-file metrics");
              }
              const value = spec.direction === "lower_is_better" ? "1" : "2";
              const sourcePath = join("calibration", "golden", spec.source.path);
              mkdirSync(join(dir, "calibration", "golden"), { recursive: true });
              writeFileSync(join(dir, sourcePath), value);
              return {
                kind: "copy-fixture-file",
                sourcePath,
                targetPath: spec.source.path,
              };
            }),
          },
          adversarial: {
            setup: objectiveMetrics.map((metric) => {
              const spec = metric as {
                direction: "lower_is_better" | "higher_is_better";
                source: { kind: "text-file"; path: string };
              };
              const value = spec.direction === "lower_is_better" ? "2" : "1";
              const sourcePath = join("calibration", "adversarial", spec.source.path);
              mkdirSync(join(dir, "calibration", "adversarial"), {
                recursive: true,
              });
              writeFileSync(join(dir, sourcePath), value);
              return {
                kind: "copy-fixture-file",
                sourcePath,
                targetPath: spec.source.path,
              };
            }),
          },
        };
  writeFileSync(
    join(dir, "fixture.json"),
    JSON.stringify({
      id,
      description: id,
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [predicate],
      preRunExpectations: [{ predicate, expected: "fail" }],
      controlDecisions,
      ...(objectiveMetrics !== undefined && { objectiveMetrics }),
      ...(verifierCalibration !== undefined && { verifierCalibration }),
      provenance: {
        kind: "smoke-fixture",
        justification: "minimal test fixture for eval-set unit tests",
      },
    }),
  );
}

export function seedAcceptedAlternativeFailureFixture(root: string): void {
  const id = "accepted-alternative-failure";
  const dir = join(root, id);
  mkdirSync(join(dir, "initial", "scripts"), { recursive: true });
  mkdirSync(join(dir, "calibration", "golden"), { recursive: true });
  mkdirSync(
    join(dir, "calibration", "accepted-alternatives", "alternate-output"),
    { recursive: true },
  );
  mkdirSync(join(dir, "calibration", "adversarial"), { recursive: true });
  writeFileSync(
    join(dir, "initial", "scripts", "check.mjs"),
    `import { existsSync, readFileSync } from "node:fs";
const value = existsSync("result.txt") ? readFileSync("result.txt", "utf8").trim() : "";
process.exit(value === "ok" ? 0 : 1);
`,
  );
  writeFileSync(join(dir, "calibration", "golden", "result.txt"), "ok\n");
  writeFileSync(
    join(
      dir,
      "calibration",
      "accepted-alternatives",
      "alternate-output",
      "result.txt",
    ),
    "also-ok\n",
  );
  writeFileSync(join(dir, "calibration", "adversarial", "result.txt"), "shortcut\n");
  writeFileSync(
    join(dir, "fixture.json"),
    JSON.stringify({
      id,
      description: "accepted alternative false negative fixture",
      role: "builder",
      workflowName: "noop",
      budgetMs: 60_000,
      predicates: [
        {
          kind: "shell-succeeds",
          command: "node scripts/check.mjs",
          timeoutMs: 10_000,
        },
      ],
      preRunExpectations: [
        {
          predicate: {
            kind: "shell-succeeds",
            command: "node scripts/check.mjs",
            timeoutMs: 10_000,
          },
          expected: "fail",
        },
      ],
      controlDecisions: ["act"],
      verifierCalibration: {
        null: {},
        golden: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/golden/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
        acceptedAlternatives: [
          {
            id: "alternate-output",
            setup: [
              {
                kind: "copy-fixture-file",
                sourcePath: "calibration/accepted-alternatives/alternate-output/result.txt",
                targetPath: "result.txt",
              },
            ],
          },
        ],
        adversarial: {
          setup: [
            {
              kind: "copy-fixture-file",
              sourcePath: "calibration/adversarial/result.txt",
              targetPath: "result.txt",
            },
          ],
        },
      },
      provenance: {
        kind: "smoke-fixture",
        justification: "tests accepted alternative calibration failure aggregation",
      },
    }),
  );
}
