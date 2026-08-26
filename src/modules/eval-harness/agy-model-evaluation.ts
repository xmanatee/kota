import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PRESET_ENV_VAR } from "#core/model/preset.js";
import {
  type AgyModelAvailabilityProbe,
  probeAgyModelAvailability,
  validateAgyEvaluationEffort,
} from "./agy-model-availability.js";
import { collectAgyCandidateReport } from "./agy-model-evaluation-artifacts.js";
import { validateAgyScenarioFixtures } from "./agy-model-evaluation-fixtures.js";
import { requireAgyModelEvaluationIsolation } from "./agy-model-evaluation-isolation.js";
import {
  AGY_MODEL_EVALUATION_EFFORT,
  AGY_MODEL_EVALUATION_HARNESS,
  AGY_MODEL_EVALUATION_NATIVE_EFFORT,
  AGY_MODEL_EVALUATION_SCENARIOS,
  type AgyCandidateEvaluationReport,
  type AgyModelEvaluationOptions,
  type AgyModelEvaluationResult,
} from "./agy-model-evaluation-types.js";
import {
  evalRunsRootFor,
  fixturesRootFor,
} from "./eval-operations.js";
import {
  createEvalRunExecution,
  type EvalRunExecution,
} from "./eval-run-execution.js";
import { type EvalSetReport, runEvalSet } from "./eval-set.js";
import { type LoadedFixture, loadFixture } from "./fixture.js";

type AgyCandidateExecutionInput = {
  projectDir: string;
  model: string;
  fixtures: readonly LoadedFixture[];
  artifactDir: string;
  options: AgyModelEvaluationOptions;
};

export type AgyModelEvaluationDependencies = {
  probeAvailability(
    requestedModels: readonly string[],
    execution: EvalRunExecution,
  ): AgyModelAvailabilityProbe;
  createExecution(
    projectDir: string,
    options: AgyModelEvaluationOptions,
    env: NodeJS.ProcessEnv,
  ): EvalRunExecution;
  createArtifactDir(projectDir: string, startedAt: Date): string;
  now(): Date;
};

function uniqueCandidates(candidates: readonly string[]): string[] {
  return [...new Set(candidates.map((candidate) => candidate.trim()).filter(Boolean))];
}

function defaultArtifactDir(projectDir: string, startedAt: Date): string {
  const stamp = startedAt.toISOString().replace(/[:.]/g, "-");
  const artifactDir = join(
    evalRunsRootFor(projectDir),
    `${stamp}-agy-model-evaluation`,
  );
  mkdirSync(artifactDir, { recursive: true });
  return realpathSync(artifactDir);
}

function candidateArtifactName(model: string): string {
  const readable = model
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const hash = createHash("sha256").update(model).digest("hex").slice(0, 10);
  return `${readable || "model"}-${hash}`;
}

async function executeCandidate(
  input: AgyCandidateExecutionInput,
  execution: EvalRunExecution,
): Promise<EvalSetReport> {
  mkdirSync(input.artifactDir, { recursive: true });
  const forcedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    [PRESET_ENV_VAR]: "antigravity-cli",
  };
  return runEvalSet({
    projectDir: input.projectDir,
    fixtures: input.fixtures,
    executor: execution.executor,
    requestedProfile: execution.requestedProfile,
    agentExecutionOverride: {
      harness: AGY_MODEL_EVALUATION_HARNESS,
      model: input.model,
      effort: AGY_MODEL_EVALUATION_EFFORT,
    },
    runArtifactBaseDir: realpathSync(input.artifactDir),
    repeatCount: input.options.repeatCount ?? 1,
    keepWorkingDirs: true,
    env: forcedEnv,
  });
}

const DEFAULT_DEPENDENCIES: AgyModelEvaluationDependencies = {
  probeAvailability: (models, execution) =>
    probeAgyModelAvailability(models, execution),
  createExecution: createEvalRunExecution,
  createArtifactDir: defaultArtifactDir,
  now: () => new Date(),
};

export async function runAgyModelEvaluationSuite(
  projectDir: string,
  options: AgyModelEvaluationOptions,
  dependencyOverrides: Partial<AgyModelEvaluationDependencies> = {},
): Promise<AgyModelEvaluationResult> {
  const deps = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides };
  const candidates = uniqueCandidates(options.candidates);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: "no_candidates",
      message: "AGY model evaluation requires at least one candidate model.",
      artifactDir: null,
    };
  }
  const effort = validateAgyEvaluationEffort(options.effort);
  if (!effort.ok) {
    return {
      ok: false,
      reason: "effort_unavailable",
      message: effort.message,
      artifactDir: null,
    };
  }
  try {
    requireAgyModelEvaluationIsolation(options.isolationBackend);
  } catch (error) {
    return {
      ok: false,
      reason: "isolation_configuration",
      message: error instanceof Error ? error.message : String(error),
      artifactDir: null,
    };
  }

  const startedAt = deps.now();
  const artifactDir = deps.createArtifactDir(projectDir, startedAt);
  const forcedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    [PRESET_ENV_VAR]: "antigravity-cli",
  };
  let execution: EvalRunExecution;
  try {
    execution = deps.createExecution(projectDir, options, forcedEnv);
  } catch (error) {
    return {
      ok: false,
      reason: "evaluation_error",
      message: error instanceof Error ? error.message : String(error),
      artifactDir,
    };
  }
  const availability = deps.probeAvailability(candidates, execution);
  writeFileSync(
    join(artifactDir, "agy-availability.json"),
    JSON.stringify(availability.evidence, null, 2),
  );
  if (!availability.ok) {
    return {
      ok: false,
      reason: availability.reason,
      message: availability.message,
      artifactDir,
      availability: availability.evidence,
    };
  }

  let fixtures: LoadedFixture[];
  try {
    const root = fixturesRootFor();
    fixtures = AGY_MODEL_EVALUATION_SCENARIOS.map((scenario) =>
      loadFixture(root, scenario.fixtureId),
    );
    validateAgyScenarioFixtures(projectDir, fixtures);
  } catch (error) {
    return {
      ok: false,
      reason: "fixture_configuration",
      message: error instanceof Error ? error.message : String(error),
      artifactDir,
      availability: availability.evidence,
    };
  }

  const candidateReports: AgyCandidateEvaluationReport[] = [];
  try {
    for (const candidate of candidates) {
      const candidateArtifactDir = join(
        artifactDir,
        candidateArtifactName(candidate),
      );
      mkdirSync(candidateArtifactDir, { recursive: true });
      const candidateExecution = await executeCandidate(
        {
          projectDir,
          model: candidate,
          fixtures,
          artifactDir: candidateArtifactDir,
          options,
        },
        execution,
      );
      candidateReports.push(
        collectAgyCandidateReport({
          suiteArtifactDir: artifactDir,
          candidateArtifactDir,
          candidate,
          execution: candidateExecution,
          keepWorkingDirs: options.keepWorkingDirs ?? false,
        }),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeFileSync(
      join(artifactDir, "agy-model-evaluation-error.json"),
      JSON.stringify({ message }, null, 2),
    );
    return {
      ok: false,
      reason: "evaluation_error",
      message,
      artifactDir,
      availability: availability.evidence,
    };
  }

  const completedAt = deps.now().toISOString();
  const report = {
    harness: AGY_MODEL_EVALUATION_HARNESS,
    effort: AGY_MODEL_EVALUATION_EFFORT,
    nativeEffort: AGY_MODEL_EVALUATION_NATIVE_EFFORT,
    repeatCount: options.repeatCount ?? 1,
    scenarios: AGY_MODEL_EVALUATION_SCENARIOS,
    availability: availability.evidence,
    candidates: candidateReports,
    startedAt: startedAt.toISOString(),
    completedAt,
    artifactDir,
  } as const;
  writeFileSync(
    join(artifactDir, "agy-model-evaluation-report.json"),
    JSON.stringify(report, null, 2),
  );
  return { ok: true, report };
}
