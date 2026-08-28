import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expectStructuredOutput,
  typedCodeStep,
} from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { stepSucceeded } from "#modules/autonomy/shared.js";
import { taskQueueValidationOperation } from "#modules/repo-tasks/task-queue-validation-operation.js";
import { evaluateAdmission } from "./admission.js";
import { collectAstArchitectureObservations } from "./ast-provider.js";
import { observationToSignal } from "./fitness-functions.js";
import {
  emptyGardenerRunState,
  GARDENER_STATE_KEY,
  updateGardenerRunState,
} from "./gardener-state.js";
import { stageGardenerTask } from "./gardener-task.js";
import { formulateHypothesisFromAdmission } from "./hypothesis.js";
import { evaluateParetoComparator } from "./pareto.js";
import type {
  AdmissionEvaluation,
  ArchitectureGardenerRunState,
  ArchitectureObservation,
  ParetoEvaluation,
  SimplificationHypothesis,
} from "./types.js";

export const ARCHITECTURE_REVIEW_REQUESTED_EVENT = "architecture.review.requested";
export const ARCHITECTURE_GARDENER_RUN_ARTIFACT = "architecture-gardener-run.json";

export type CollectObservationsOutput = {
  readonly observations: readonly ArchitectureObservation[];
};

export type EvaluateAdmissionOutput = {
  readonly evaluations: readonly AdmissionEvaluation[];
  readonly admitted: readonly AdmissionEvaluation[];
};

export type FormulateHypothesesOutput = {
  readonly hypotheses: readonly SimplificationHypothesis[];
};

export type ParetoEvaluationOutput = {
  readonly evaluations: readonly ParetoEvaluation[];
  readonly topHypothesis: SimplificationHypothesis | null;
  readonly topPareto: ParetoEvaluation | null;
};

export type StageTaskOutput = {
  readonly staged: boolean;
  readonly taskId: string | null;
  readonly proposalKey: string | null;
  readonly touchedTaskQueue: boolean;
};

const collectObservations = typedCodeStep<CollectObservationsOutput>({
  id: "collect-observations",
  type: "code",
  validate: (raw) =>
    expectStructuredOutput<CollectObservationsOutput>(raw, ["observations"]),
  run: async (ctx) => {
    const observations = collectAstArchitectureObservations(ctx.workspaceRoot);
    return { observations };
  },
});

const evaluateAdmissionStep = typedCodeStep<EvaluateAdmissionOutput>({
  id: "evaluate-admission",
  type: "code",
  when: stepSucceeded("collect-observations"),
  validate: (raw) =>
    expectStructuredOutput<EvaluateAdmissionOutput>(raw, [
      "evaluations",
      "admitted",
    ]),
  run: async (ctx) => {
    const observations = collectObservations.outputRequired(ctx).observations;
    const snapshot = ctx.state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY);
    const storedState = snapshot.value ?? emptyGardenerRunState();

    // Group observations by scope
    const byScope = new Map<string, ArchitectureObservation[]>();
    for (const obs of observations) {
      const list = byScope.get(obs.targetScope) ?? [];
      list.push(obs);
      byScope.set(obs.targetScope, list);
    }

    const triggerPayload = ctx.trigger.payload as Record<string, unknown> | undefined;
    const explicitTarget = typeof triggerPayload?.targetScope === "string"
      ? triggerPayload.targetScope
      : undefined;

    const evaluations: AdmissionEvaluation[] = [];

    // If explicit target was requested without existing observations, include it
    if (explicitTarget && !byScope.has(explicitTarget)) {
      byScope.set(explicitTarget, []);
    }

    for (const [scope, obsList] of byScope.entries()) {
      const signals = obsList.map(observationToSignal);
      const cooldownExpiry = storedState.cooldowns[scope];
      const evaluation = evaluateAdmission({
        targetScope: scope,
        signals,
        explicitRequest: explicitTarget
          ? {
              targetScope: explicitTarget,
              reason: typeof triggerPayload?.reason === "string"
                ? triggerPayload.reason
                : undefined,
            }
          : undefined,
        storedFingerprints: storedState.fingerprints,
        cooldownExpiry,
      });
      evaluations.push(evaluation);
    }

    const admitted = evaluations.filter((e) => e.admitted);
    return { evaluations, admitted };
  },
});

const formulateHypotheses = typedCodeStep<FormulateHypothesesOutput>({
  id: "formulate-hypotheses",
  type: "code",
  when: (ctx) => {
    const adm = evaluateAdmissionStep.output(ctx);
    return adm !== undefined && adm.admitted.length > 0;
  },
  validate: (raw) =>
    expectStructuredOutput<FormulateHypothesesOutput>(raw, ["hypotheses"]),
  run: async (ctx) => {
    const admitted = evaluateAdmissionStep.outputRequired(ctx).admitted;
    const hypotheses = admitted.map((evaluation) =>
      formulateHypothesisFromAdmission({ evaluation }),
    );
    return { hypotheses };
  },
});

const paretoEvaluationStep = typedCodeStep<ParetoEvaluationOutput>({
  id: "pareto-evaluation",
  type: "code",
  when: stepSucceeded("formulate-hypotheses"),
  validate: (raw) =>
    expectStructuredOutput<ParetoEvaluationOutput>(raw, [
      "evaluations",
      "topHypothesis",
      "topPareto",
    ]),
  run: async (ctx) => {
    const hypotheses = formulateHypotheses.outputRequired(ctx).hypotheses;
    const evaluations: ParetoEvaluation[] = [];

    let topHypothesis: SimplificationHypothesis | null = null;
    let topPareto: ParetoEvaluation | null = null;

    for (const hyp of hypotheses) {
      const p = evaluateParetoComparator(hyp);
      evaluations.push(p);
      if (p.disposition === "accepted") {
        if (!topPareto || p.score > topPareto.score) {
          topPareto = p;
          topHypothesis = hyp;
        }
      }
    }

    return { evaluations, topHypothesis, topPareto };
  },
});

const stageTaskStep = typedCodeStep<StageTaskOutput>({
  id: "stage-task",
  type: "code",
  when: (ctx) => {
    const pareto = paretoEvaluationStep.output(ctx);
    return pareto !== undefined && pareto.topHypothesis !== null && pareto.topPareto !== null;
  },
  validate: (raw) =>
    expectStructuredOutput<StageTaskOutput>(raw, [
      "staged",
      "taskId",
      "proposalKey",
      "touchedTaskQueue",
    ]),
  run: async (ctx) => {
    const { topHypothesis, topPareto } = paretoEvaluationStep.outputRequired(ctx);
    if (!topHypothesis || !topPareto) {
      return {
        staged: false,
        taskId: null,
        proposalKey: null,
        touchedTaskQueue: false,
      };
    }

    const stagedResult = stageGardenerTask({
      workspaceRoot: ctx.workspaceRoot,
      runId: ctx.workflow.runId,
      hypothesis: topHypothesis,
      pareto: topPareto,
    });

    return {
      staged: true,
      taskId: stagedResult.taskId,
      proposalKey: stagedResult.proposalKey,
      touchedTaskQueue: stagedResult.touchedTaskQueue,
    };
  },
});

const writeCommitMessage = typedCodeStep<{ written: boolean }>({
  id: "write-commit-message",
  type: "code",
  when: (ctx) => stageTaskStep.output(ctx)?.touchedTaskQueue === true,
  validate: (raw) => expectStructuredOutput<{ written: boolean }>(raw, ["written"]),
  run: async (ctx) => {
    const staged = stageTaskStep.outputRequired(ctx);
    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
      join(ctx.workflow.runDirPath, "commit-message.txt"),
      `architecture-gardener: stage ${staged.taskId ?? "task"}\n`,
      "utf-8",
    );
    return { written: true };
  },
});

const validateChanges = typedCodeStep<{ ok: true }>({
  id: "validate-changes",
  type: "code",
  when: stepSucceeded("write-commit-message"),
  validate: (raw) => expectStructuredOutput<{ ok: true }>(raw, ["ok"]),
  run: async (ctx) => {
    await ctx.runBlocking(taskQueueValidationOperation, {
      workspaceRoot: ctx.workspaceRoot,
    });
    return { ok: true } as const;
  },
});

const persistStateAndArtifacts = typedCodeStep<{ persisted: boolean }>({
  id: "persist-state-and-artifacts",
  type: "code",
  when: stepSucceeded("collect-observations"),
  validate: (raw) => expectStructuredOutput<{ persisted: boolean }>(raw, ["persisted"]),
  run: async (ctx) => {
    const observations = collectObservations.output(ctx)?.observations ?? [];
    const admissionOut = evaluateAdmissionStep.output(ctx);
    const paretoOut = paretoEvaluationStep.output(ctx);
    const stagedOut = stageTaskStep.output(ctx);

    const snapshot = ctx.state.read<ArchitectureGardenerRunState>(GARDENER_STATE_KEY);
    const currentState = snapshot.value ?? emptyGardenerRunState();

    const newDispositions = (admissionOut?.evaluations ?? []).map((e) => ({
      targetScope: e.targetScope,
      disposition: e.disposition,
      reason: e.reason,
      taskId: e.targetScope === paretoOut?.topHypothesis?.targetScope
        ? stagedOut?.taskId ?? undefined
        : undefined,
    }));

    const newFingerprints = observations.map((o) => ({
      fingerprint: o.fingerprint,
      targetScope: o.targetScope,
      observationKind: o.kind,
    }));

    // If a task was staged, cool down the target scope for 24 hours
    const cooldownTargets = stagedOut?.staged && paretoOut?.topHypothesis
      ? [paretoOut.topHypothesis.targetScope]
      : [];

    const nextState = updateGardenerRunState({
      current: currentState,
      runId: ctx.workflow.runId,
      newFingerprints,
      newDispositions,
      cooldownTargets,
    });

    ctx.state.compareAndSet(GARDENER_STATE_KEY, snapshot.revision, nextState);

    // Retain detailed evidence in run artifacts
    const artifact = {
      schemaVersion: 1,
      runId: ctx.workflow.runId,
      executedAt: new Date().toISOString(),
      observations,
      evaluations: admissionOut?.evaluations ?? [],
      hypotheses: formulateHypotheses.output(ctx)?.hypotheses ?? [],
      paretoEvaluations: paretoOut?.evaluations ?? [],
      staged: stagedOut ?? null,
    };

    await mkdir(ctx.workflow.runDirPath, { recursive: true });
    await writeFile(
      join(ctx.workflow.runDirPath, ARCHITECTURE_GARDENER_RUN_ARTIFACT),
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf-8",
    );

    return { persisted: true };
  },
});

const architectureGardenerWorkflow: WorkflowDefinitionInput = {
  name: "architecture-gardener",
  repository: "write",
  integration: { validationCommand: ["pnpm", "validate-tasks"] },
  description:
    "Continuous architectural simplification: collect AST observations, evaluate admission, formulate hypotheses, run Pareto comparator, and stage implementation work.",
  defaultAutonomyMode: "autonomous",
  triggers: [{ event: ARCHITECTURE_REVIEW_REQUESTED_EVENT }],
  steps: [
    collectObservations,
    evaluateAdmissionStep,
    formulateHypotheses,
    paretoEvaluationStep,
    stageTaskStep,
    writeCommitMessage,
    validateChanges,
    persistStateAndArtifacts,
  ],
};

export default architectureGardenerWorkflow;
