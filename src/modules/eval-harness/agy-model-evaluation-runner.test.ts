import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildKotaAgentCommandTrace } from "#core/agent-harness/index.js";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import { projectKotaAgentMessageForStorage } from "#core/workflow/run-evidence.js";
import "#modules/antigravity-cli-agent-harness/index.js";
import {
  type AgyModelEvaluationDependencies,
  runAgyModelEvaluationSuite,
} from "./agy-model-evaluation.js";
import {
  AGY_EXECUTION_PROFILE,
  cleanupAgyModelEvaluationTestEnvironment,
  configureFakeCandidateContainer,
  executeVerifierOnTestHost,
  tempDir,
} from "./agy-model-evaluation-test-support.js";
import {
  AGY_MODEL_EVALUATION_SCENARIOS,
  type AgyModelEvaluationOptions,
} from "./agy-model-evaluation-types.js";
import type { WorkflowExecutionRequest } from "./runner.js";
import { TEST_PROFILE } from "./runner-test-profiles.js";

afterEach(cleanupAgyModelEvaluationTestEnvironment);

describe("AGY model evaluation runner", () => {
  it(
    "calibrates verifiers and reaches all three scenario executors with the Antigravity override",
    async () => {
      const artifactDir = tempDir("kota-agy-suite-artifacts-");
      const binariesDir = tempDir("kota-agy-suite-bin-");
      const containerLog = join(artifactDir, "availability-container.jsonl");
      const options = configureFakeCandidateContainer(binariesDir, containerLog);
      const fixedDate = new Date("2026-08-11T12:00:00.000Z");
      const requests: WorkflowExecutionRequest[] = [];
      const executionOptions: AgyModelEvaluationOptions[] = [];
      const createExecution: AgyModelEvaluationDependencies["createExecution"] =
        (_projectDir, options, env) => {
          executionOptions.push(options);
          expect(env[PRESET_ENV_VAR]).toBe("antigravity-cli");
          return {
            executor: {
              predicateContext: {
                executableVerifier: executeVerifierOnTestHost,
              },
              preflight: () => AGY_EXECUTION_PROFILE,
              execute: async (request) => {
                requests.push(request);
                const traceDir = join(
                  request.workingDir,
                  ".kota",
                  "runs",
                  `run-${requests.length}-builder`,
                );
                mkdirSync(join(traceDir, "steps"), { recursive: true });
                const scenario = AGY_MODEL_EVALUATION_SCENARIOS.find(
                  (entry) => request.workingDir.includes(entry.fixtureId),
                );
                if (scenario === undefined) {
                  throw new Error(
                    `No AGY scenario matched ${request.workingDir}.`,
                  );
                }
                writeFileSync(
                  join(traceDir, "steps", "build.events.jsonl"),
                  `${scenario.instructionTraceRules
                    .filter((rule) => rule.kind === "required-command")
                    .map((rule) =>
                      JSON.stringify(
                        projectKotaAgentMessageForStorage({
                          type: "status",
                          category: "tool",
                          toolName: "run_command",
                          commandTrace: buildKotaAgentCommandTrace(rule.command),
                          output: [JSON.stringify({ command: rule.command })],
                        }),
                      ),
                    )
                    .join("\n")}\n`,
                );
                return {
                  kind: "completed",
                  durationMs: 10,
                  runArtifactPath: traceDir,
                };
              },
            },
            requestedProfile: TEST_PROFILE,
            isolationBackend: options.isolationBackend,
            executorEnv: {
              [PRESET_ENV_VAR]: "antigravity-cli",
            },
          };
        };

      const result = await runAgyModelEvaluationSuite(
        process.cwd(),
        options,
        {
          createExecution,
          createArtifactDir: () => artifactDir,
          now: () => fixedDate,
        },
      );

      if (!result.ok) throw new Error(result.message);
      expect(result.ok).toBe(true);
      expect(executionOptions).toHaveLength(1);
      expect(executionOptions[0].isolationBackend).toEqual(
        options.isolationBackend,
      );
      const availabilityInvocation = JSON.parse(
        readFileSync(containerLog, "utf8").trim(),
      ) as {
        args: string[];
        command: string;
        commandArgs: string[];
        image: string;
      };
      expect(availabilityInvocation.command).toBe("agy");
      expect(availabilityInvocation.commandArgs).toEqual(["models"]);
      expect(availabilityInvocation.image).toBe("kota-eval:latest");
      expect(
        availabilityInvocation.args.slice(
          availabilityInvocation.args.indexOf("--network"),
          availabilityInvocation.args.indexOf("--network") + 2,
        ),
      ).toEqual(["--network", "kota-google-egress"]);
      expect(result.report.availability.detail).toContain(
        'container image "kota-eval:latest"',
      );
      expect(requests).toHaveLength(3);
      expect(
        requests.map((request) => request.agentExecutionOverride),
      ).toEqual([
        {
          harness: "antigravity-cli",
          model: "gemini-3.6-flash",
          effort: "max",
        },
        {
          harness: "antigravity-cli",
          model: "gemini-3.6-flash",
          effort: "max",
        },
        {
          harness: "antigravity-cli",
          model: "gemini-3.6-flash",
          effort: "max",
        },
      ]);
      expect(
        requests.every((request) => request.replayRecordingsRoot === undefined),
      ).toBe(true);
      expect(result.report.candidates[0]).toMatchObject({
        model: "gemini-3.6-flash",
        harness: "antigravity-cli",
        effort: "max",
        nativeEffort: "high",
        scenarioRunCount: 3,
      });
      expect(
        result.report.candidates[0].scenarioVerdicts.map(
          (verdict) => verdict.scenario,
        ),
      ).toEqual(["planning", "scoped-coding", "repair"]);
      for (const verdict of result.report.candidates[0].scenarioVerdicts) {
        expect(existsSync(join(artifactDir, verdict.traceArtifactPath))).toBe(
          true,
        );
        expect(
          existsSync(join(artifactDir, verdict.workflowTraceArtifactPath!)),
        ).toBe(true);
        expect(
          JSON.parse(
            readFileSync(
              join(artifactDir, verdict.traceArtifactPath),
              "utf8",
            ),
          ),
        ).toMatchObject({
          harness: "antigravity-cli",
          effort: "max",
          execution: { kind: "completed" },
        });
      }
    },
    120_000,
  );
});
