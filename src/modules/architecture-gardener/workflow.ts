import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection, decodeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { AUTONOMY_AGENT_DEFAULTS, AUTONOMY_AGENT_HANG_TIMEOUT_MS, AUTONOMY_AGENT_TIER, stepSucceeded } from "#modules/autonomy/shared.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { taskQueueValidationOperation } from "#modules/repo-tasks/task-queue-validation-operation.js";
import { type AdmissionEvaluation, evaluateAdmission } from "./admission.js";
import { decodeGardenerDecision, gardenerDecisionOutputSchema } from "./decision.js";
import { architectureReviewRequested } from "./events.js";
import { computeFingerprint } from "./fingerprint.js";
import { emptyGardenerRunState, GARDENER_STATE_KEY } from "./gardener-state.js";
import { stageGardenerTask } from "./gardener-task.js";
import { collectObservationsOperation, deliveryObservations, normalizeObservationTarget, observationsForTarget } from "./observations.js";
import type { ArchitectureGardenerRunState, ArchitectureObservation } from "./types.js";

export const ARCHITECTURE_GARDENER_RUN_ARTIFACT = "architecture-gardener-run.json";
export const agent: AgentDef = {
  name: "architecture-gardener",
  role: "Investigate real consumers and delivery friction; propose grounded simplification or no action.",
  promptPath: "src/modules/architecture-gardener/prompt.md",
  ...AUTONOMY_AGENT_DEFAULTS,
  writeScope: "deny-all",
};

type InvestigationInput = {
  observations: ArchitectureObservation[];
  terminalTaskEvidence: string[];
  admission: AdmissionEvaluation;
  linkedTasks: Array<{ taskId: string; state: string; path: string }>;
};

const inspect = typedCodeStep<InvestigationInput>({
  id: "inspect-evidence", type: "code",
  exposeOutputToAgent: true, exposedOutputTrust: "untrusted",
  validate: (raw) => expectStructuredOutput<InvestigationInput>(raw, ["observations", "admission", "linkedTasks", "terminalTaskEvidence"]),
  run: async (ctx) => {
    const state = ctx.state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value ?? emptyGardenerRunState();
    const observations = await ctx.runBlocking(collectObservationsOperation, { workspaceRoot: ctx.workspaceRoot });
    const projection = decodeAutonomyIssueProjection(ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value);
    observations.push(...deliveryObservations(projection));
    const payload = ctx.trigger.payload;
    const explicitRequest = ctx.trigger.event === architectureReviewRequested.name || ctx.trigger.event === "manual";
    const targetScope = explicitRequest && typeof payload.targetScope === "string"
      ? normalizeObservationTarget(payload.targetScope) : "repo";
    const relevant = observationsForTarget(observations, targetScope);
    const tasks = listFullRepoTasks(ctx.workspaceRoot);
    const linkedIds = new Set(state.linkedTaskIds);
    const linked = tasks.filter((task) => linkedIds.has(task.id));
    const terminalTaskEvidence = linked.filter((task) => task.state === "done" || task.state === "dropped")
      .map((task) => computeFingerprint({ id: task.id, state: task.state, body: task.body }));
    return {
      terminalTaskEvidence,
      observations: relevant,
      linkedTasks: linked.map((task) => ({ taskId: task.id, state: task.state, path: `data/tasks/${task.state === "done" || task.state === "dropped" ? "archive/" : ""}${task.id}.md` })),
      admission: evaluateAdmission({ targetScope, observations: relevant, explicitRequest,
        previousCohort: state.reviewedCohorts[targetScope],
        followUpFingerprints: terminalTaskEvidence,
        reviewedTaskEvidence: state.reviewedTaskEvidence,
      }),
    };
  },
});

const apply = typedCodeStep<ReturnType<typeof stageGardenerTask>>({
  id: "apply-decision", type: "code", when: stepSucceeded("investigate"),
  validate: (raw) => expectStructuredOutput<ReturnType<typeof stageGardenerTask>>(raw, ["taskId", "proposalKey", "touchedTaskQueue"]),
  run: (ctx) => stageGardenerTask({ workspaceRoot: ctx.workspaceRoot, runId: ctx.workflow.runId,
    decision: decodeGardenerDecision(ctx.stepOutputs.investigate) }),
});

const finish = typedCodeStep<{ recorded: true }>({
  id: "record-investigation", type: "code", when: stepSucceeded("inspect-evidence"),
  validate: (raw) => expectStructuredOutput<{ recorded: true }>(raw, ["recorded"]),
  run: async (ctx) => {
    const input = inspect.outputRequired(ctx);
    const decision = input.admission.admitted ? decodeGardenerDecision(ctx.stepOutputs.investigate) : null;
    const staged = apply.output(ctx) ?? null;
    if (staged?.touchedTaskQueue) {
      await ctx.runBlocking(taskQueueValidationOperation, { workspaceRoot: ctx.workspaceRoot });
      await mkdir(ctx.workflow.runDirPath, { recursive: true });
      await writeFile(join(ctx.workflow.runDirPath, "commit-message.txt"), `architecture-gardener: propose ${staged.taskId}\n`);
    }
    if (decision) {
      const snapshot = ctx.state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY);
      const current = snapshot.value ?? emptyGardenerRunState();
      const { targetScope, cohort } = input.admission;
      const now = new Date().toISOString();
      ctx.state.compareAndSet(GARDENER_STATE_KEY, snapshot.revision, {
        ...current, updatedAt: now, lastRunId: ctx.workflow.runId,
        reviewedTaskEvidence: [...new Set([...current.reviewedTaskEvidence, ...input.terminalTaskEvidence])],
        linkedTaskIds: [...new Set([...current.linkedTaskIds, ...(staged?.taskId ? [staged.taskId] : [])])],
        reviewedCohorts: { ...current.reviewedCohorts, [targetScope]: cohort },
        dispositions: { ...current.dispositions, [targetScope]: {
          targetScope, disposition: decision.action === "propose" ? "proposed" : decision.action,
          reason: decision.rationale, decidedAt: now,
          taskId: staged?.taskId ?? current.dispositions[targetScope]?.taskId ?? null,
        } },
      });
    }
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(join(ctx.workflow.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT),
      `${JSON.stringify({ schemaVersion: 2, runId: ctx.workflow.runId, ...input, decision, staged }, null, 2)}\n`);
    return { recorded: true };
  },
});

const architectureGardenerWorkflow: WorkflowDefinitionInput = {
  name: "architecture-gardener", repository: "write",
  resources: () => [GARDENER_STATE_KEY],
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description: "Investigate changed architecture and delivery evidence, then propose implementation work or justify no action.",
  defaultAutonomyMode: "autonomous",
  triggers: [
    { event: architectureReviewRequested.name, queueMode: "all" },
    { event: "workflow.completed", filter: { workflow: ["builder"] } },
    { event: autonomyIssueDecisionRequested.name },
  ],
  steps: [inspect, {
    id: "investigate", type: "agent", agentName: agent.name, promptPath: agent.promptPath,
    tier: AUTONOMY_AGENT_TIER, effort: AUTONOMY_AGENT_DEFAULTS.effort,
    timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
    outputFormat: "json", outputSchema: gardenerDecisionOutputSchema, validate: decodeGardenerDecision,
    when: (ctx) => inspect.output(ctx)?.admission.admitted === true,
  }, apply, finish],
};
export default architectureGardenerWorkflow;
