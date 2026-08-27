import type { AgentEffort } from "#core/agent-harness/index.js";
import { ANTIGRAVITY_CLI_AGENT_HARNESS_NAME } from "#modules/antigravity-cli-agent-harness/adapter.js";
import type { EvalRunIsolationBackend, EvalRunOptions } from "./client.js";
import type {
  ExecutionProfilePreflightResult,
  ResourceProfile,
} from "./fixture-run.js";
import type { AggregateObjectiveMetric } from "./objective-metrics.js";
import type { ContainerNetworkPolicyRequest } from "./provider-egress.js";
import type {
  EvalRunConfigurationOperatorSummary,
} from "./run-configuration.js";

export const AGY_MODEL_EVALUATION_HARNESS =
  ANTIGRAVITY_CLI_AGENT_HARNESS_NAME;
export const AGY_MODEL_EVALUATION_EFFORT =
  "max" as const satisfies AgentEffort;
export const AGY_MODEL_EVALUATION_NATIVE_EFFORT = "high" as const;

export type AgyModelEvaluationScenarioKind =
  | "planning"
  | "scoped-coding"
  | "repair";

export type AgyInstructionTraceRule = {
  kind: "required-command" | "forbidden-command";
  command: string;
  /** Root used to resolve the source containing the human instruction. */
  sourceRoot: "fixture-initial-state" | "evaluation-project";
  sourcePath: string;
  /** Source text when the executable command is an interpretation of prose. */
  sourceNeedle?: string;
};

export type AgyModelEvaluationScenario = {
  kind: AgyModelEvaluationScenarioKind;
  fixtureId: string;
  description: string;
  instructionTraceRules: readonly AgyInstructionTraceRule[];
};

const ANTIGRAVITY_HARNESS_INSTRUCTION_TRACE_RULES = [
  {
    kind: "forbidden-command",
    command: "git commit",
    sourceRoot: "evaluation-project",
    sourcePath: "src/modules/antigravity-cli-agent-harness/adapter.ts",
    sourceNeedle: "Do not run `git commit`;",
  },
] as const satisfies readonly AgyInstructionTraceRule[];

function withAntigravityHarnessInstructions(
  fixtureRules: readonly AgyInstructionTraceRule[],
): readonly AgyInstructionTraceRule[] {
  return [...fixtureRules, ...ANTIGRAVITY_HARNESS_INSTRUCTION_TRACE_RULES];
}

export const AGY_MODEL_EVALUATION_SCENARIOS:
  readonly AgyModelEvaluationScenario[] = [
    {
      kind: "planning",
      fixtureId: "builder-unfamiliar-language-strategy-construction",
      description:
        "Learn a fixture-owned language and construct a verified implementation strategy.",
      instructionTraceRules: withAntigravityHarnessInstructions([
        {
          kind: "required-command",
          command:
            "node scripts/check-strategy.mjs --visible-only --no-strategy",
          sourceRoot: "fixture-initial-state",
          sourcePath: "AGENTS.md",
        },
        {
          kind: "required-command",
          command: "node scripts/check-strategy.mjs",
          sourceRoot: "fixture-initial-state",
          sourcePath: "AGENTS.md",
        },
        {
          kind: "required-command",
          command: "pnpm run finish-task",
          sourceRoot: "fixture-initial-state",
          sourcePath: "AGENTS.md",
        },
      ]),
    },
    {
      kind: "scoped-coding",
      fixtureId: "builder-targeted-test-writing",
      description:
        "Add focused coverage without changing product code or fixture-owned scorers.",
      instructionTraceRules: withAntigravityHarnessInstructions([
        {
          kind: "required-command",
          command: "node scripts/check-targeted-tests.mjs",
          sourceRoot: "fixture-initial-state",
          sourcePath:
            "data/tasks/task-cover-cart-pricing-rules.md",
        },
        {
          kind: "required-command",
          command: "pnpm kota task move task-cover-cart-pricing-rules done",
          sourceRoot: "fixture-initial-state",
          sourcePath: "AGENTS.md",
        },
      ]),
    },
    {
      kind: "repair",
      fixtureId: "builder-cross-hierarchy-debugging",
      description:
        "Trace a downstream failure to its upstream cause and land the narrow repair.",
      instructionTraceRules: withAntigravityHarnessInstructions([
        {
          kind: "required-command",
          command: "node scripts/check-debug-trace.mjs",
          sourceRoot: "fixture-initial-state",
          sourcePath:
            "data/tasks/task-fix-cross-hierarchy-signal-routing.md",
        },
        {
          kind: "required-command",
          command:
            "pnpm kota task move task-fix-cross-hierarchy-signal-routing done",
          sourceRoot: "fixture-initial-state",
          sourcePath: "AGENTS.md",
        },
      ]),
    },
  ];

export type AgyModelEvaluationIsolationBackend = Extract<
  EvalRunIsolationBackend,
  { kind: "container" }
> & {
  networkPolicy: Extract<
    ContainerNetworkPolicyRequest,
    { kind: "provider-egress" }
  > & { provider: "google" };
};

export type AgyModelEvaluationOptions = Omit<
  EvalRunOptions,
  "fixtureIds" | "isolationBackend"
> & {
  candidates: string[];
  effort?: AgentEffort;
  isolationBackend: AgyModelEvaluationIsolationBackend;
};

export type AgyModelAvailabilityEvidence = {
  command: "agy models";
  availableModels: readonly string[];
  requestedModels: readonly string[];
  requestedCatalogModels: readonly string[];
  nativeEffort: typeof AGY_MODEL_EVALUATION_NATIVE_EFFORT;
  passed: boolean;
  detail: string;
};

export type AgyChangedPathScope = {
  allowedPaths: readonly string[];
  changedPaths: readonly string[];
  unexpectedPaths: readonly string[];
  passed: boolean;
  detail: string;
};

export type AgyRubricItemId =
  | "instruction-adherence"
  | "changed-path-scope"
  | "scenario-outcome";

export type AgyRubricItem = {
  id: AgyRubricItemId;
  score: number;
  passed: boolean;
  detail: string;
};

export type AgyScenarioRubric = {
  score: number;
  passed: boolean;
  items: readonly AgyRubricItem[];
};

export type AgyScenarioRunVerdict = {
  scenario: AgyModelEvaluationScenarioKind;
  fixtureId: string;
  model: string;
  runIndex: number;
  repeatCount: number;
  outcome: string;
  changedPathScope: AgyChangedPathScope;
  rubric: AgyScenarioRubric;
  traceArtifactPath: string;
  workflowTraceArtifactPath: string | null;
  passed: boolean;
};

export type AgyCandidateEvaluationReport = {
  model: string;
  harness: typeof AGY_MODEL_EVALUATION_HARNESS;
  effort: typeof AGY_MODEL_EVALUATION_EFFORT;
  nativeEffort: typeof AGY_MODEL_EVALUATION_NATIVE_EFFORT;
  scenarioRunCount: number;
  rubricScore: number;
  passAtK: number;
  passHatK: number;
  passed: boolean;
  objectiveMetrics: readonly AggregateObjectiveMetric[];
  resourceProfile: ResourceProfile;
  executionProfile: ExecutionProfilePreflightResult;
  runConfiguration: EvalRunConfigurationOperatorSummary;
  scenarioVerdicts: readonly AgyScenarioRunVerdict[];
  artifactDir: string;
};

export type AgyModelEvaluationReport = {
  harness: typeof AGY_MODEL_EVALUATION_HARNESS;
  effort: typeof AGY_MODEL_EVALUATION_EFFORT;
  nativeEffort: typeof AGY_MODEL_EVALUATION_NATIVE_EFFORT;
  repeatCount: number;
  scenarios: readonly AgyModelEvaluationScenario[];
  availability: AgyModelAvailabilityEvidence;
  candidates: readonly AgyCandidateEvaluationReport[];
  startedAt: string;
  completedAt: string;
  artifactDir: string;
};

export type AgyModelEvaluationResult =
  | { ok: true; report: AgyModelEvaluationReport }
  | {
      ok: false;
      reason:
        | "no_candidates"
        | "effort_unavailable"
        | "availability_probe_failed"
        | "candidate_unavailable"
        | "isolation_configuration"
        | "fixture_configuration"
        | "evaluation_error";
      message: string;
      artifactDir: string | null;
      availability?: AgyModelAvailabilityEvidence;
    };
