import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { AgentDef } from "#core/agents/agent-types.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { expectStructuredOutput, typedCodeStep } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput, WorkflowPostReconcileInvariant } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "#modules/autonomy/autonomy-issue-events.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection, decodeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { createGeneratedWorkQuestionQueue } from "#modules/autonomy/generated-work-owner-question.js";
import { canPublishGeneratedWorkOwnerEffects, finalizeGeneratedWorkOwnerEffects } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { improvementHandoffRequested, improvementHandoffSchema } from "#modules/autonomy/improvement-handoff.js";
import { assessAutonomyQueue } from "#modules/autonomy/queue-policy.js";
import { AUTONOMY_AGENT_DEFAULTS, AUTONOMY_AGENT_HANG_TIMEOUT_MS, AUTONOMY_AGENT_TIER, stepSucceeded } from "#modules/autonomy/shared.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { taskQueueIntegrationPolicy } from "#modules/repo-tasks/task-integration-policy.js";
import { repoWorkSupplyOperation, resolveRepoWorkSupplyInput } from "#modules/repo-tasks/work-supply.js";
import { type AdmissionEvaluation, evaluateAdmission, relevantDeliveryCohort, settleGardenerAssessments } from "./admission.js";
import { decodeGardenerDecision, gardenerDecisionOutputSchema } from "./decision.js";
import { architectureReviewRequested } from "./events.js";
import { computeFingerprint } from "./fingerprint.js";
import { emptyGardenerRunState, GARDENER_STATE_KEY } from "./gardener-state.js";
import { type GardenerTaskSettlement, gardenerTaskFingerprint, readHeldTaskIds, stageGardenerTask } from "./gardener-task.js";
import { collectObservationsOperation, deliveryObservations, normalizeObservationTarget, observationsForTarget } from "./observations.js";
import { ARCHITECTURE_GARDENER_RUN_ARTIFACT, readGardenerProposalIdentities } from "./proposal-identity.js";
import type { ArchitectureGardenerRunState, ArchitectureObservation, GardenerProposalIdentity, StoredDispositionRecord } from "./types.js";

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
  linkedTasks: Array<{ taskId: string; state: string; path: string; fingerprint: string }>;
  handoff: z.infer<typeof handoffSchema> | null;
  requestFingerprint: string | null;
  previousJudgments: StoredDispositionRecord[];
  proposalIdentities: GardenerProposalIdentity[];
  unresolvedTaskIds: string[];
};

type ReviewedTask = { taskId: string; fingerprint: string };
type InvestigationSettlement = GardenerTaskSettlement & { reviewedTasks: ReviewedTask[] };

function scopesOverlap(left: string, right: string): boolean {
  const a = normalizeObservationTarget(left);
  const b = normalizeObservationTarget(right);
  return a === "repo" || b === "repo" || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

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
  const deliveryKeys = new Set(input.observations.filter((o) => o.category === "delivery").map((o) => o.id));
  if (new Set(decision.revisit.deliveryIssueKeys).size !== decision.revisit.deliveryIssueKeys.length ||
    decision.revisit.deliveryIssueKeys.some((key) => !deliveryKeys.has(key))) {
    throw new Error("Revisit conditions must identify distinct observed delivery issues");
  }
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
  validate: (raw) => expectStructuredOutput<InvestigationInput>(raw, ["observations", "admission", "linkedTasks", "terminalTaskEvidence", "handoff", "unresolvedTaskIds"]),
  run: async (ctx) => {
    const state = ctx.state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY).value ?? emptyGardenerRunState();
    const queue = ctx.trigger.event === "autonomy.queue.empty"
      ? await ctx.runBlocking(repoWorkSupplyOperation, resolveRepoWorkSupplyInput({
        workspaceRoot: ctx.scopeRoot, scopeRoot: ctx.scopeRoot, stateDir: ctx.runtimeStateDir,
      })) : null;
    const observations = await ctx.runBlocking(collectObservationsOperation, { workspaceRoot: ctx.workspaceRoot });
    const projection = decodeAutonomyIssueProjection(ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY).value);
    observations.push(...deliveryObservations(projection));
    const payload = ctx.trigger.payload;
    const handoff = ctx.trigger.event === improvementHandoffRequested.name ? handoffSchema.parse(payload) : null;
    const explicitRequest = handoff !== null || ctx.trigger.event === architectureReviewRequested.name || ctx.trigger.event === "manual";
    const targetScope = explicitRequest && typeof payload.targetScope === "string"
      ? normalizeObservationTarget(payload.targetScope) : "repo";
    const requestFingerprint = handoff ? computeFingerprint({ topicKey: handoff.topicKey, evidence: handoff.evidenceFingerprint })
      : explicitRequest && typeof payload.reason === "string" ? computeFingerprint(payload.reason.trim()) : null;
    const relevant = observationsForTarget(observations, targetScope);
    const tasks = listFullRepoTasks(ctx.workspaceRoot);
    const previousJudgments = Object.values(state.dispositions).filter((record) => scopesOverlap(record.targetScope, targetScope));
    const allIdentities = await readGardenerProposalIdentities({ state,
      runsRoot: dirname(ctx.workflow.runDirPath), workspaceRoot: ctx.workspaceRoot });
    // Lost historical identity also means lost scope attribution. Keep these
    // ownership constraints even when a scoped review excludes other tasks.
    const unresolvedTaskIds = [...new Set([...state.linkedTaskIds,
      ...Object.values(state.dispositions).flatMap((record) => record.taskId ? [record.taskId] : []),
    ])].filter((taskId) => taskId.startsWith("task-generated-") && !allIdentities.some((identity) => identity.taskId === taskId));
    const proposalIdentities = allIdentities.filter((identity) => scopesOverlap(identity.targetScope, targetScope));
    const linkedIds = new Set(targetScope === "repo" ? state.linkedTaskIds : [
      ...previousJudgments.flatMap((record) => record.taskId && !allIdentities.some((identity) => identity.taskId === record.taskId) ? [record.taskId] : []),
      ...proposalIdentities.map((identity) => identity.taskId),
    ]);
    const linked = tasks.filter((task) => linkedIds.has(task.id));
    const heldTaskIds = readHeldTaskIds(ctx.runEvidence, ctx.workflow.runId);
    const terminalTaskEvidence = linked.filter((task) => task.state === "done" || task.state === "dropped")
      .map((task) => computeFingerprint({ id: task.id, state: task.state, body: task.body, held: heldTaskIds?.includes(task.id) ?? null }));
    const admission = evaluateAdmission({ targetScope, observations: relevant, explicitRequest,
      idle: queue !== null,
      requestFingerprint,
      previousReview: state.dispositions[targetScope]?.review,
      followUpFingerprints: terminalTaskEvidence,
      reviewedTaskEvidence: state.reviewedTaskEvidence,
    });
    if (queue && (!assessAutonomyQueue(queue).empty || queue.runningCount + queue.queuedCount >= queue.capacity)) {
      admission.admitted = false;
      admission.reason = queue.ownershipAvailable
        ? "Useful delivery work has priority over idle investigation."
        : "Idle investigation awaits available runtime ownership.";
    }
    return {
      handoff,
      requestFingerprint,
      previousJudgments,
      proposalIdentities,
      unresolvedTaskIds,
      terminalTaskEvidence,
      observations: relevant,
      linkedTasks: linked.map((task) => ({ taskId: task.id, state: task.state,
        path: `data/tasks/${task.state === "done" || task.state === "dropped" ? "archive/" : ""}${task.id}.md`,
        fingerprint: gardenerTaskFingerprint(ctx.workspaceRoot, task.id) })),
      admission,
    };
  },
});

const apply = typedCodeStep<InvestigationSettlement>({
  id: "apply-decision", type: "code", when: stepSucceeded("investigate"),
  validate: (raw) => expectStructuredOutput<InvestigationSettlement>(raw, ["taskId", "proposalKey", "touchedTaskQueue", "disposition", "reason", "sourceTaskFingerprint", "appliedTaskFingerprint", "reviewedTasks"]),
  run: (ctx) => {
    const input = inspect.outputRequired(ctx);
    const decision = decodeInvestigation(ctx.stepOutputs.investigate, input);
    const priorKeys = [...new Set(input.proposalIdentities.filter((identity) =>
      identity.mechanismKey === decision.proposal?.mechanismKey).map((identity) => identity.proposalKey))];
    if (!input.handoff && priorKeys.length > 1) {
      throw new Error("Multiple handoff topics identify this mechanism; a scoped topic is required to settle the correct task");
    }
    const defaultTask = decision.proposal
      ? findGeneratedWorkTask(ctx.workspaceRoot, `architecture-gardener:${decision.proposal.mechanismKey}`)?.task : null;
    if (decision.proposal && !input.handoff && priorKeys.length === 0 && !defaultTask && input.unresolvedTaskIds.length > 0) {
      throw new Error("Linked gardener task identity is unavailable; restore its run evidence or provide the original scoped handoff before proposing work");
    }
    const reviewedTasks: ReviewedTask[] = input.linkedTasks.map(({ taskId, fingerprint }) => ({ taskId, fingerprint }));
    // The agent can cite task evidence it discovers beyond the supplied links.
    // Capture it before materialization, including no-action decisions.
    const refs = [...decision.evidenceRefs, ...(input.handoff?.evidenceRefs ?? [])];
    for (const task of listFullRepoTasks(ctx.workspaceRoot)) {
      if (!reviewedTasks.some((entry) => entry.taskId === task.id) && refs.some((ref) =>
        ref === task.id || ref.replace(/[:#].*$/, "").endsWith(`/tasks/${task.id}.md`) ||
        ref.replace(/[:#].*$/, "").endsWith(`/tasks/archive/${task.id}.md`))) {
        reviewedTasks.push({ taskId: task.id, fingerprint: gardenerTaskFingerprint(ctx.workspaceRoot, task.id) });
      }
    }
    return { ...stageGardenerTask({ workspaceRoot: ctx.workspaceRoot, runId: ctx.workflow.runId,
      topicKey: input.handoff?.topicKey ?? priorKeys[0], decision,
      heldTaskIds: readHeldTaskIds(ctx.runEvidence, ctx.workflow.runId) }), reviewedTasks };
  },
});

const finish = typedCodeStep<{ recorded: true }>({
  id: "record-investigation", type: "code", when: stepSucceeded("inspect-evidence"),
  validate: (raw) => expectStructuredOutput<{ recorded: true }>(raw, ["recorded"]),
  run: async (ctx) => {
    const input = inspect.outputRequired(ctx);
    const decision = input.admission.admitted ? decodeInvestigation(ctx.stepOutputs.investigate, input) : null;
    const staged = decision ? apply.outputRequired(ctx) : null;
    if (staged?.touchedTaskQueue) {
      await mkdir(ctx.workflow.runDirPath, { recursive: true });
      await writeFile(join(ctx.workflow.runDirPath, "commit-message.txt"), `architecture-gardener: settle ${staged.taskId}\n`);
    }
    if (decision) {
      const snapshot = ctx.state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY);
      const current = snapshot.value ?? emptyGardenerRunState();
      const { targetScope, cohort } = input.admission;
      const now = new Date().toISOString();
      const proposalIdentities = [...(current.dispositions[targetScope]?.proposalIdentities ?? [])];
      for (const identity of input.proposalIdentities) {
        if (!proposalIdentities.some((entry) => entry.proposalKey === identity.proposalKey && entry.mechanismKey === identity.mechanismKey)) {
          proposalIdentities.push(identity);
        }
      }
      if (decision.proposal && staged?.proposalKey && staged.taskId &&
        !proposalIdentities.some((identity) => identity.mechanismKey === decision.proposal!.mechanismKey && identity.proposalKey === staged.proposalKey)) {
        const original = input.proposalIdentities
          .find((identity) => identity.proposalKey === staged.proposalKey);
        const previousOwner = input.previousJudgments.find((record) => record.taskId === staged.taskId);
        proposalIdentities.push({ targetScope: original?.targetScope ?? previousOwner?.targetScope ?? targetScope,
          mechanismKey: decision.proposal.mechanismKey, proposalKey: staged.proposalKey, taskId: staged.taskId });
      }
      ctx.state.compareAndSet(GARDENER_STATE_KEY, snapshot.revision, {
        ...current, updatedAt: now, lastRunId: ctx.workflow.runId,
        reviewedTaskEvidence: [...new Set([...current.reviewedTaskEvidence, ...input.terminalTaskEvidence])],
        linkedTaskIds: [...new Set([...current.linkedTaskIds, ...(staged?.taskId ? [staged.taskId] : [])])],
        reviewedCohorts: { ...current.reviewedCohorts, [targetScope]: cohort },
        dispositions: { ...current.dispositions, [targetScope]: {
          targetScope, disposition: staged!.disposition,
          reason: staged!.reason === decision.rationale ? decision.rationale : `${decision.rationale}\n${staged!.reason}`, decidedAt: now,
          taskId: staged?.taskId ?? current.dispositions[targetScope]?.taskId ?? null,
          proposalIdentities,
          review: { decision,
            assessments: settleGardenerAssessments(current.dispositions[targetScope]?.review, input.observations, decision),
            structuralCohort: input.admission.structuralCohort,
            deliveryCohort: relevantDeliveryCohort(input.observations, decision.revisit.deliveryIssueKeys),
            requestFingerprint: input.requestFingerprint ?? current.dispositions[targetScope]?.review?.requestFingerprint ?? null },
        } },
      });
    }
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(join(ctx.workflow.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT),
      `${JSON.stringify({ schemaVersion: 2, runId: ctx.workflow.runId, ...input, decision, staged }, null, 2)}\n`);
    return { recorded: true };
  },
});

export const verifyGardenerSettlementAfterReconcile: WorkflowPostReconcileInvariant = (input) => {
  input.signal.throwIfAborted();
  const artifact = readOptionalJsonFile<{ staged: InvestigationSettlement | null }>(
    join(input.stateDir, "runs", input.runId, ARCHITECTURE_GARDENER_RUN_ARTIFACT));
  if (!artifact) return { satisfied: false, reason: "Gardener settlement artifact is missing" };
  const staged = artifact.staged;
  if (staged && (!staged.reviewedTasks || staged.reviewedTasks.some((task) =>
    task.fingerprint !== gardenerTaskFingerprint(input.repoRoot, task.taskId) ||
    (task.taskId === staged.taskId ? staged.appliedTaskFingerprint : task.fingerprint) !== gardenerTaskFingerprint(input.workspaceRoot, task.taskId)))) {
    return { satisfied: false, reason: "Reviewed task evidence changed after investigation; reconcile this judgment before consuming its evidence." };
  }
  if (!staged?.taskId) return { satisfied: true };
  return staged.sourceTaskFingerprint === gardenerTaskFingerprint(input.repoRoot, staged.taskId) &&
    staged.appliedTaskFingerprint === gardenerTaskFingerprint(input.workspaceRoot, staged.taskId)
    ? { satisfied: true }
    : { satisfied: false, reason: "Generated task source or applied outcome changed after investigation; preserve the current task owner and reconcile this review." };
};

const architectureGardenerWorkflow: WorkflowDefinitionInput = {
  name: "architecture-gardener", repository: "write",
  finalize: (ctx) => {
    const raw = ctx.stepOutputs["apply-decision"];
    if (raw === undefined) return;
    const staged = expectStructuredOutput<InvestigationSettlement>(raw, ["proposal", "disposition"]);
    if (staged.disposition !== "applied" || staged.proposal === null) return;
    if (canPublishGeneratedWorkOwnerEffects({ workspaceRoot: ctx.scopeRoot, proposal: staged.proposal, fresh: true })) {
      finalizeGeneratedWorkOwnerEffects({ workspaceRoot: ctx.scopeRoot, proposal: staged.proposal,
        ownerQuestionQueue: createGeneratedWorkQuestionQueue(ctx.scopeRoot) });
    }
  },
  tags: ["systemic-observer"],
  resources: () => [GARDENER_STATE_KEY],
  integration: taskQueueIntegrationPolicy({ postReconcile: verifyGardenerSettlementAfterReconcile }),
  description: "Investigate changed architecture and delivery evidence, then propose implementation work or justify no action.",
  defaultAutonomyMode: "autonomous",
  triggers: [
    { event: "autonomy.queue.empty" },
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
      ctx.stepOutputs["inspect-evidence"], ["observations", "admission", "linkedTasks", "terminalTaskEvidence", "handoff", "unresolvedTaskIds"])),
    when: (ctx) => inspect.output(ctx)?.admission.admitted === true,
  }, apply, finish],
};
export default architectureGardenerWorkflow;
