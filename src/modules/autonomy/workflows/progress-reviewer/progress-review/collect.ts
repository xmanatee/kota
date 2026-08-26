import type { EventJournal } from "#core/events/event-journal.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  type AutonomyIssueProjection,
  emptyAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import type { ProgressReviewSemanticInput } from "../semantic-input.js";
import { cloneDeadLetterEvidence, cloneEvidenceItem, evidenceRefs } from "./agent-packet.js";
import { listArtifactEvidence } from "./artifact-evidence.js";
import { listCanonicalProgressState } from "./canonical-state-evidence.js";
import { listBatchEvents } from "./event-evidence.js";
import type { ProgressReviewGitEvidenceByScope } from "./git-evidence.js";
import {
  listDeadLetterCounts,
  listScopedApprovalEvidence,
  listScopedDeadLetterEvidence,
  listScopedOwnerQuestionEvidence,
} from "./operator-evidence.js";
import { listRecentRunsForSources } from "./run-evidence.js";
import {
  listDeadLetterReferencedTasks,
  listRecentTasks,
  operatorJourneyRisks,
  taskClassDistribution,
} from "./task-evidence.js";
import {
  batchSummary,
  classifyProgressReviewTrigger,
  directoryScopeForSource,
  readWindowMs,
  requestPayload,
  selectEvidenceTarget,
} from "./trigger-target.js";
import type {
  ProgressReviewDeadLetterCounts,
  ProgressReviewDeadLetterEvidence,
  ProgressReviewDirectorySource,
  ProgressReviewEvidencePacket,
  ProgressReviewEvidenceWindow,
  ProgressReviewScopeEvidence,
} from "./types.js";

function cloneDeadLetterCounts(
  counts: ProgressReviewDeadLetterCounts,
): ProgressReviewDeadLetterCounts {
  return {
    ...counts,
    openItemIds: [...counts.openItemIds],
    redriveRunIds: [...counts.redriveRunIds],
  };
}

function collectProgressReviewEvidenceForSource(args: {
  source: ProgressReviewDirectorySource;
  trigger: WorkflowRunTrigger;
  window: ProgressReviewEvidenceWindow;
  windowStartMs: number;
  stateDir: string;
  eventJournal?: EventJournal;
  semanticInput: ProgressReviewSemanticInput;
  gitEvidenceByScope?: ProgressReviewGitEvidenceByScope;
  autonomyIssueProjection: AutonomyIssueProjection;
}): ProgressReviewScopeEvidence {
  const excluded: string[] = [];
  const gitCollection = args.gitEvidenceByScope?.[args.source.scopeId];
  if (gitCollection) excluded.push(...gitCollection.excluded);
  const scopedRuns = listRecentRunsForSources(
    [args.source],
    args.windowStartMs,
    args.trigger,
    excluded,
  );
  const runs = scopedRuns.map((run) => run.evidence);
  const tasks = listRecentTasks([args.source], args.windowStartMs, excluded);
  const events = listBatchEvents(
    args.source,
    args.trigger,
    args.windowStartMs,
    excluded,
    {
      stateDir: args.source.stateDir,
      eventJournal:
        args.source.stateDir === args.stateDir ? args.eventJournal : undefined,
    },
  );
  const artifacts = listArtifactEvidence(scopedRuns, excluded);
  const git = gitCollection?.evidence ?? [];
  const ownerQuestions = listScopedOwnerQuestionEvidence([args.source], args.windowStartMs, excluded);
  const approvals = listScopedApprovalEvidence([args.source], args.windowStartMs, excluded);
  const deadLetterCounts = listDeadLetterCounts([args.source]);
  const deadLetters = listScopedDeadLetterEvidence([args.source], excluded);
  const canonicalState = listCanonicalProgressState({
    source: args.source,
    semanticInput: args.semanticInput,
    autonomyIssueProjection: args.autonomyIssueProjection,
  });
  const allTasks = [
    ...tasks,
    ...listDeadLetterReferencedTasks(args.source, deadLetters, tasks, excluded),
  ];
  const taskClassCounts = taskClassDistribution(allTasks);
  const journeyRisks = operatorJourneyRisks(allTasks);
  const evidence = evidenceRefs({
    runs,
    tasks: allTasks,
    events,
    artifacts,
    git,
    ownerQuestions,
    approvals,
    deadLetters,
    state: canonicalState,
  });
  return {
    scope: directoryScopeForSource(args.source),
    window: { ...args.window },
    runs,
    tasks: allTasks,
    events,
    artifacts,
    git,
    ownerQuestions,
    approvals,
    deadLetterCounts,
    deadLetters,
    canonicalState,
    taskClassDistribution: taskClassCounts,
    operatorJourneyRisks: journeyRisks,
    evidence,
    excluded,
  };
}

function aggregateExcluded(scopes: readonly ProgressReviewScopeEvidence[]): string[] {
  if (scopes.length === 1) return [...(scopes[0]?.excluded ?? [])];
  return scopes.flatMap((scope) =>
    scope.excluded.map((item) => `${scope.scope.displayName}: ${item}`),
  );
}

export function collectProgressReviewEvidence(args: {
  projectDir: string;
  scopeDir: string;
  stateDir: string;
  eventJournal?: EventJournal;
  trigger: WorkflowRunTrigger;
  now: Date;
  semanticInput?: ProgressReviewSemanticInput;
  gitEvidenceByScope?: ProgressReviewGitEvidenceByScope;
  autonomyIssueProjection?: AutonomyIssueProjection;
}): ProgressReviewEvidencePacket {
  const payload = requestPayload(args.trigger);
  const semanticInput = args.semanticInput ?? {
    automatic: false,
    shouldReview: true,
    boundary: "explicit-request" as const,
    inputRevision: null,
    evidenceRefs: [],
    reason: "explicit progress review request",
    deliveryAttempt: 0,
  };
  const autonomyIssueProjection =
    args.autonomyIssueProjection ?? emptyAutonomyIssueProjection();
  const windowMs = readWindowMs(payload);
  const endedAt = args.now.toISOString();
  const startedAtMs = args.now.getTime() - windowMs;
  const startedAt = new Date(startedAtMs).toISOString();
  const stateDir = args.stateDir;
  const target = selectEvidenceTarget(
    args.projectDir,
    args.scopeDir,
    args.trigger,
    stateDir,
  );
  const window = {
    startedAt,
    endedAt,
    maxAgeMs: windowMs,
  };
  const scopes = target.sources.map((source) =>
    collectProgressReviewEvidenceForSource({
      source,
      trigger: args.trigger,
      window,
      windowStartMs: startedAtMs,
      stateDir,
      eventJournal: args.eventJournal,
      semanticInput,
      gitEvidenceByScope: args.gitEvidenceByScope,
      autonomyIssueProjection,
    }),
  );
  const runs = scopes.flatMap((scope) => scope.runs.map(cloneEvidenceItem));
  const tasks = scopes.flatMap((scope) => scope.tasks.map(cloneEvidenceItem));
  const events = scopes.flatMap((scope) => scope.events.map(cloneEvidenceItem));
  const artifacts = scopes.flatMap((scope) => scope.artifacts.map(cloneEvidenceItem));
  const git = scopes.flatMap((scope) => scope.git.map(cloneEvidenceItem));
  const ownerQuestions = scopes.flatMap((scope) => scope.ownerQuestions.map(cloneEvidenceItem));
  const approvals = scopes.flatMap((scope) => scope.approvals.map(cloneEvidenceItem));
  const deadLetterCounts = scopes.flatMap((scope) =>
    scope.deadLetterCounts.map(cloneDeadLetterCounts),
  );
  const deadLetters: ProgressReviewDeadLetterEvidence[] = scopes.flatMap((scope) =>
    scope.deadLetters.map(cloneDeadLetterEvidence),
  );
  const canonicalState = scopes.flatMap((scope) =>
    scope.canonicalState.map(cloneEvidenceItem)
  );
  const taskClassCounts = taskClassDistribution(tasks);
  const journeyRisks = operatorJourneyRisks(tasks);
  const evidence = evidenceRefs({
    runs,
    tasks,
    events,
    artifacts,
    git,
    ownerQuestions,
    approvals,
    deadLetters,
    state: canonicalState,
  });
  const batch = batchSummary(args.trigger);
  const journalBackfillCount = events.filter(
    (event) => event.source === "journal",
  ).length;

  return {
    generatedAt: endedAt,
    semanticInput: {
      automatic: semanticInput.automatic,
      boundary: semanticInput.boundary,
      inputRevision: semanticInput.inputRevision,
      evidenceRefs: [...semanticInput.evidenceRefs],
      reason: semanticInput.reason,
    },
    triggerKind: classifyProgressReviewTrigger(args.trigger),
    triggerEvent: args.trigger.event,
    scope: target.scope,
    window,
    batch: batch ? { ...batch, journalBackfillCount } : null,
    scopes,
    runs,
    tasks,
    events,
    artifacts,
    git,
    ownerQuestions,
    approvals,
    deadLetterCounts,
    deadLetters,
    canonicalState,
    taskClassDistribution: taskClassCounts,
    operatorJourneyRisks: journeyRisks,
    evidence,
    excluded: aggregateExcluded(scopes),
  };
}

export type ProgressReviewEvidenceOperationInput = {
  projectDir: string;
  scopeDir: string;
  stateDir: string;
  trigger: WorkflowRunTrigger;
  nowIso: string;
  semanticInput: ProgressReviewSemanticInput;
  gitEvidenceByScope: ProgressReviewGitEvidenceByScope;
  autonomyIssueProjection: AutonomyIssueProjection;
};

export function collectProgressReviewEvidenceInWorker(
  input: ProgressReviewEvidenceOperationInput,
): ProgressReviewEvidencePacket {
  return collectProgressReviewEvidence({
    projectDir: input.projectDir,
    scopeDir: input.scopeDir,
    stateDir: input.stateDir,
    trigger: input.trigger,
    now: new Date(input.nowIso),
    semanticInput: input.semanticInput,
    gitEvidenceByScope: input.gitEvidenceByScope,
    autonomyIssueProjection: input.autonomyIssueProjection,
  });
}

export const collectProgressReviewEvidenceOperation =
  defineWorkflowBlockingOperation<
    ProgressReviewEvidenceOperationInput,
    ProgressReviewEvidencePacket
  >(import.meta.url, "collectProgressReviewEvidenceInWorker");
