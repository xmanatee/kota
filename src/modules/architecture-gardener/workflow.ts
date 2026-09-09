import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentDef } from "#core/agents/agent-types.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection, decodeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { improvementHandoffRequested, improvementHandoffSchema } from "#modules/autonomy/improvement-handoff.js";
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
  handoff: z.infer<typeof handoffSchema> | null;
};

const handoffSchema = improvementHandoffSchema.omit({ evidenceIds: true }).extend({
  owner: z.literal("architecture-gardener"),
  evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  evidenceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strip();
const evidenceAssessmentSchema = z.array(z.object({
  ref: z.string().trim().min(1),
  available: z.boolean(),
  assessment: z.string().trim().min(1),
}).strict());
const investigationOutputSchema = {
  ...gardenerDecisionOutputSchema,
  properties: {
    ...gardenerDecisionOutputSchema.properties,
    evidenceAssessment: z.toJSONSchema(evidenceAssessmentSchema),
  },
};

function decodeInvestigation(raw: unknown, input: InvestigationInput) {
  const { evidenceAssessment, ...decisionRaw } = z.object({
    evidenceAssessment: evidenceAssessmentSchema.optional(),
  }).passthrough().parse(raw);
  const decision = decodeGardenerDecision(decisionRaw);
  if (!input.handoff) return evidenceAssessment ? { ...decision, evidenceAssessment } : decision;
  if (!evidenceAssessment) throw new Error("Investigation must assess every handoff reference, including unavailable evidence");
  const allowed = new Set([
    ...input.handoff.evidenceRefs,
    ...input.observations.map((observation) => observation.fingerprint),
    ...decision.evidenceRefs,
  ]);
  const assessed = new Map(evidenceAssessment.map((entry) => [entry.ref, entry]));
  if (assessed.size !== evidenceAssessment.length || evidenceAssessment.some((entry) => !allowed.has(entry.ref))) {
    throw new Error("Investigation contains duplicate or unknown evidence references");
  }
  if (input.handoff.evidenceRefs.some((ref) => !assessed.has(ref))) {
    throw new Error("Investigation must assess every handoff reference, including unavailable evidence");
  }
  if (decision.action === "propose" && decision.evidenceRefs.some((ref) => assessed.get(ref)?.available !== true)) {
    throw new Error("A proposal requires assessed, available evidence for its target");
  }
  return { ...decision, evidenceAssessment };
}

const inspect = typedCodeStep<InvestigationInput>({
  id: "inspect-evidence", type: "code",
  exposeOutputToAgent: true, exposedOutputTrust: "untrusted",
  validate: (raw) => expectStructuredOutput<InvestigationInput>(raw, ["observations", "admission", "linkedTasks", "terminalTaskEvidence", "handoff"]),
  run: async (ctx) => {
    const state = ctx.state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value ?? emptyGardenerRunState();
    const observations = await ctx.runBlocking(collectObservationsOperation, { workspaceRoot: ctx.workspaceRoot });
    const projection = decodeAutonomyIssueProjection(ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value);
    observations.push(...deliveryObservations(projection));
    const payload = ctx.trigger.payload;
    const handoff = ctx.trigger.event === improvementHandoffRequested.name ? handoffSchema.parse(payload) : null;
    const explicitRequest = handoff !== null || ctx.trigger.event === architectureReviewRequested.name || ctx.trigger.event === "manual";
    const targetScope = explicitRequest && typeof payload.targetScope === "string"
      ? normalizeObservationTarget(payload.targetScope) : "repo";
    const relevant = observationsForTarget(observations, targetScope);
    const tasks = listFullRepoTasks(ctx.workspaceRoot);
    const linkedIds = new Set(state.linkedTaskIds);
    const linked = tasks.filter((task) => linkedIds.has(task.id));
    const terminalTaskEvidence = linked.filter((task) => task.state === "done" || task.state === "dropped")
      .map((task) => computeFingerprint({ id: task.id, state: task.state, body: task.body }));
    return {
      handoff,
      terminalTaskEvidence,
      observations: relevant,
      linkedTasks: linked.map((task) => ({ taskId: task.id, state: task.state, path: `data/tasks/${task.state === "done" || task.state === "dropped" ? "archive/" : ""}${task.id}.md` })),
      admission: evaluateAdmission({ targetScope, observations: relevant, explicitRequest,
        // Publication suppresses unchanged handoffs and defers active topics.
        // Delivered counterevidence must reach the investigator even without an AST delta.
        previousCohort: handoff ? undefined : state.reviewedCohorts[targetScope],
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
    topicKey: inspect.outputRequired(ctx).handoff?.topicKey,
    decision: decodeInvestigation(ctx.stepOutputs.investigate, inspect.outputRequired(ctx)) }),
});

const finish = typedCodeStep<{ recorded: true }>({
  id: "record-investigation", type: "code", when: stepSucceeded("inspect-evidence"),
  validate: (raw) => expectStructuredOutput<{ recorded: true }>(raw, ["recorded"]),
  run: async (ctx) => {
    const input = inspect.outputRequired(ctx);
    const decision = input.admission.admitted ? decodeInvestigation(ctx.stepOutputs.investigate, input) : null;
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
  tags: ["systemic-observer"],
  resources: () => [GARDENER_STATE_KEY],
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description: "Investigate changed architecture and delivery evidence, then propose implementation work or justify no action.",
  defaultAutonomyMode: "autonomous",
  triggers: [
    { event: architectureReviewRequested.name, queueMode: "all" },
    { event: improvementHandoffRequested.name, filter: { owner: "architecture-gardener" }, queueMode: "all" },
    { event: "workflow.completed", filter: { workflow: ["builder"] } },
    { event: autonomyIssueDecisionRequested.name },
  ],
  steps: [inspect, {
    id: "investigate", type: "agent", agentName: agent.name, promptPath: agent.promptPath,
    tier: AUTONOMY_AGENT_TIER, effort: AUTONOMY_AGENT_DEFAULTS.effort,
    timeoutMs: AUTONOMY_AGENT_HANG_TIMEOUT_MS,
    outputFormat: "json",
    outputSchema: investigationOutputSchema,
    validate: (raw, ctx) => decodeInvestigation(raw, expectStructuredOutput<InvestigationInput>(
      ctx.stepOutputs["inspect-evidence"], ["observations", "admission", "linkedTasks", "terminalTaskEvidence", "handoff"])),
    when: (ctx) => inspect.output(ctx)?.admission.admitted === true,
  }, apply, finish],
};
export default architectureGardenerWorkflow;
