import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { KotaAgentMessage } from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { PRESET_ENV_VAR, resolvePreset } from "#core/model/preset.js";
import type {
  WorkflowRunMetadata,
  WorkflowRuntimeState,
  WorkflowStepContext,
  WorkflowStepResult,
} from "#core/workflow/run-types.js";
import type { WorkflowAgentStep } from "#core/workflow/step-types.js";
import { executeWorkflowStep } from "#core/workflow/run-executor-step.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import "#modules/codex-agent-harness/index.js";
import securityReviewWorkflow, {
  agent as securityReviewer,
} from "#modules/autonomy/workflows/security-review/workflow.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
} from "#modules/autonomy/workflows/security-review/security-review.js";

const runId = "2026-07-27T09-34-52-952Z-builder-o7ar1e";
const sourceRunId = "2026-07-27T09-34-53-266Z-security-review-lgkie5";
const projectDir = process.cwd();
const runDir = join(projectDir, ".kota", "runs", runId);
const runDirRelative = `.kota/runs/${runId}`;
const definitionPath = "src/modules/autonomy/workflows/security-review/workflow.ts";
const codexHome = process.env.KOTA_REVALIDATION_CODEX_HOME;
if (!codexHome) {
  throw new Error(
    "KOTA_REVALIDATION_CODEX_HOME must name an ephemeral writable copy of the harness-managed Codex login.",
  );
}
const runtimeResources = {
  profileId: "same-shape-security-revalidation",
  env: { CODEX_HOME: codexHome },
};
const commonGitDir = resolve(
  projectDir,
  execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim(),
);
const canonicalProjectDir = dirname(commonGitDir);
const sourceRunDir = join(canonicalProjectDir, ".kota", "runs", sourceRunId);

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requiredStepOutput(
  metadata: WorkflowRunMetadata,
  stepId: string,
): unknown {
  const step = metadata.steps.find((candidate) => candidate.id === stepId);
  if (step?.status !== "success" || step.output === undefined) {
    throw new Error(`Source run lacks successful output for ${stepId}.`);
  }
  return step.output;
}

mkdirSync(join(runDir, "steps"), { recursive: true });

const sourceMetadata = parseJson(
  join(sourceRunDir, "metadata.json"),
) as WorkflowRunMetadata;
const preservedInvestigationPath = join(
  runDir,
  "security-review-investigation.json",
);
const preservedInvestigationText = readFileSync(
  preservedInvestigationPath,
  "utf-8",
);
const investigation = decodeSecurityInvestigationOutput(
  JSON.parse(preservedInvestigationText),
);
const sourceRecordedInvestigation = requiredStepOutput(
  sourceMetadata,
  "record-investigation-findings",
) as Record<string, unknown>;
const trigger = sourceMetadata.trigger;
const priorStepOutputs = {
  "scan-candidates": requiredStepOutput(sourceMetadata, "scan-candidates"),
  "record-investigation-findings": {
    ...sourceRecordedInvestigation,
    findings: investigation.findings,
    artifactPath: preservedInvestigationPath,
  },
};

const config = loadConfig(projectDir);
const { preset } = resolvePreset({
  env: process.env[PRESET_ENV_VAR],
  config: config.defaultPreset,
});
const [definition] = validateWorkflowDefinitions(
  [
    registerWorkflowDefinition(definitionPath, {
      ...securityReviewWorkflow,
      moduleRoot: projectDir,
      contributingModule: "autonomy",
      moduleSource: "project",
    }),
  ],
  projectDir,
  {
    defaultAgentHarness: config.defaultAgentHarness ?? preset.harness,
    preset,
    modelTiers: config.modelTiers,
    resolveAgentDef: (name) =>
      name === securityReviewer.name ? securityReviewer : undefined,
  },
);
if (!definition) throw new Error("Security-review workflow did not validate.");
const step = definition.steps.find(
  (candidate): candidate is WorkflowAgentStep =>
    candidate.id === "revalidate-findings" && candidate.type === "agent",
);
if (!step) throw new Error("Security-review revalidate-findings step is absent.");
if (step.timeoutMs !== 1_800_000) {
  throw new Error(`Unexpected revalidation timeout: ${String(step.timeoutMs)}.`);
}

const startedAt = new Date();
const metadata: WorkflowRunMetadata = {
  id: runId,
  workflow: definition.name,
  definitionPath,
  trigger,
  startedAt: startedAt.toISOString(),
  status: "running",
  runDir: runDirRelative,
  steps: [],
};
const workflowContext = {
  name: definition.name,
  definitionPath,
  runId,
  runDir: runDirRelative,
  runDirPath: runDir,
};
const runtimeState: WorkflowRuntimeState = {
  completedRuns: 0,
  pendingRuns: [],
  workflows: {},
};
const context: WorkflowStepContext = {
  projectDir,
  workspaceDir: projectDir,
  runtimeResources,
  workflow: workflowContext,
  trigger,
  previousOutput: priorStepOutputs["record-investigation-findings"],
  stepOutputs: priorStepOutputs,
  stepResults: {},
  stepOutputList: Object.values(priorStepOutputs),
  runTool: async () => {
    throw new Error("The revalidation agent step may not call KOTA-hosted tools.");
  },
  emit: () => {},
  requestRestart: () => {
    throw new Error("The revalidation agent step may not request a restart.");
  },
  readPrompt: (path) => readFileSync(resolve(projectDir, path), "utf-8"),
  readRuntimeState: () => runtimeState,
  reportProgress: () => {},
  triggerWorkflow: async () => {
    throw new Error("The revalidation agent step may not trigger workflows.");
  },
};
const recordedSteps: WorkflowStepResult[] = [];
let messageCount = 0;
const messageTypes: Record<string, number> = {};
let inputEvidence:
  | {
      systemPromptBytes: number;
      systemPromptSha256: string;
      userPromptBytes: number;
      userPromptSha256: string;
    }
  | undefined;
const eventBus = new EventBus();
const scopeId = deriveDirectoryScopeId(projectDir);

const execution = await executeWorkflowStep(
  definition,
  step,
  {
    metadata,
    recordStep: (result) => {
      recordedSteps.push(result);
    },
    appendAgentMessage: (_stepId, message: KotaAgentMessage) => {
      messageCount += 1;
      const type = message.type;
      messageTypes[type] = (messageTypes[type] ?? 0) + 1;
    },
    writeAgentInputs: (_stepId, systemPrompt, userPrompt) => {
      const normalizedSystemPrompt = systemPrompt ?? "";
      inputEvidence = {
        systemPromptBytes: Buffer.byteLength(normalizedSystemPrompt, "utf-8"),
        systemPromptSha256: sha256(normalizedSystemPrompt),
        userPromptBytes: Buffer.byteLength(userPrompt, "utf-8"),
        userPromptSha256: sha256(userPrompt),
      };
      writeFileSync(
        join(runDir, "same-shape-revalidation-input.json"),
        `${JSON.stringify(inputEvidence, null, 2)}\n`,
        "utf-8",
      );
    },
  },
  trigger,
  context,
  new AbortController(),
  {
    projectDir,
    workspaceDir: projectDir,
    runtimeResources,
    config,
    scopeId,
    projectId: scopeId,
    resolveAgentDef: (name) =>
      name === securityReviewer.name ? securityReviewer : undefined,
    log: (message) => process.stderr.write(`${message}\n`),
  },
  {
    stepOutputsById: { ...priorStepOutputs },
    stepResultsById: {},
    stepOutputs: Object.values(priorStepOutputs),
    warnings: [],
  },
  {
    bus: eventBus,
    pbus: new ProjectScopedEventBus(eventBus, scopeId),
    log: (message) => process.stderr.write(`${message}\n`),
  },
  startedAt.getTime(),
);

const completedAt = new Date();
const sourceStep = sourceMetadata.steps.find(
  (candidate) => candidate.id === "revalidate-findings",
);
const evidenceCommon = {
  kind: "harness-driven-workflow-agent-step-revalidation",
  sourceRunId,
  sourceInvestigationSha256: sha256(preservedInvestigationText),
  preservedInvestigationArtifact: `${runDirRelative}/security-review-investigation.json`,
  codexStateMode: "ephemeral writable copy of harness-managed login",
  evaluatedHead: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim(),
  workflow: definition.name,
  definitionPath,
  promptPath: step.promptPath,
  stepId: step.id,
  harness: execution.completed.harness ?? step.harness,
  model: execution.completed.model ?? step.model,
  effort: step.effort,
  maxTurns: step.maxTurns,
  outputFormat: step.outputFormat,
  structuredOutputSchema: step.outputSchema,
  timeoutMs: step.timeoutMs,
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationMs: execution.completed.durationMs,
  activeDurationMs: execution.completed.activeDurationMs,
  input: inputEvidence,
  sourceTimedOutStep: sourceStep,
  agentMessageSummary: { count: messageCount, byType: messageTypes },
  recordedRuntimeStep: recordedSteps.at(-1),
  createdSafetyTaskIds: [
    "task-security-review-the-gemini-and-vercel-kota-hosted-",
    "task-security-review-each-project-owns-a-distinct-appro",
    "task-security-review-the-default-daemon-state-directory",
  ],
  deadLetterDisposition: {
    id: "dlq-494c3024-cca4-49e9-8376-0398d172932c",
    requestedAction: "dismiss",
    statusBefore: "open",
    statusAfter: "open",
    result: "blocked",
    reason:
      "The three findings have current-code dispositions and canonical Safety tasks, so replaying the stale trigger against a changed HEAD would duplicate that work.",
    error:
      "The canonical CLI could not reach the live daemon control endpoint and its local fallback could not write the canonical DLQ file from the builder sandbox.",
    retryCommand:
      'pnpm kota workflow dlq dismiss dlq-494c3024-cca4-49e9-8376-0398d172932c --reason "Superseded by builder run 2026-07-27T09-34-52-952Z-builder-o7ar1e after all three findings received current-code dispositions and canonical Safety tasks."',
  },
};
if (execution.completed.status !== "success") {
  const failedEvidence = {
    ...evidenceCommon,
    outcome: "not-completed",
    withinTimeout: null,
    timeoutReproduced: null,
    blocker: {
      kind: execution.agentBackoff?.kind ?? "unknown",
      reason:
        execution.completed.error ??
        execution.thrownError?.message ??
        "Same-shape revalidation failed.",
    },
  };
  writeFileSync(
    join(runDir, "security-review-revalidation-evidence.json"),
    `${JSON.stringify(failedEvidence, null, 2)}\n`,
    "utf-8",
  );
  process.stdout.write(`${JSON.stringify(failedEvidence, null, 2)}\n`);
  process.exitCode = 2;
} else {
  const merged = decodeSecurityRevalidationOutputForInvestigation(
    execution.completed.output,
    investigation,
  );
  const evidence = {
    ...evidenceCommon,
    outcome: "completed",
    withinTimeout:
      (execution.completed.activeDurationMs ?? execution.completed.durationMs) <
      step.timeoutMs,
    timeoutReproduced: false,
    structuredOutput: execution.completed.output,
    mergedFindingCount: merged.findings.length,
    mergedFindingIds: merged.findings.map((finding) => finding.id),
    mergedVerdicts: merged.findings.map(({ id, verdict }) => ({ id, verdict })),
  };
  writeFileSync(
    join(runDir, "security-review-revalidation-evidence.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf-8",
  );
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
