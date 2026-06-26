import { join } from "node:path";
import type { EventJournal } from "#core/events/event-journal.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { cloneDeadLetterEvidence, cloneEvidenceItem, evidenceRefs } from "./agent-packet.js";
import { listArtifactEvidence } from "./artifact-evidence.js";
import { listBatchEvents } from "./event-evidence.js";
import { listScopedGitEvidence } from "./git-evidence.js";
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
}): ProgressReviewScopeEvidence {
  const excluded: string[] = [];
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
      stateDir: args.stateDir,
      eventJournal: args.eventJournal,
    },
  );
  const artifacts = listArtifactEvidence(scopedRuns, excluded);
  const git = listScopedGitEvidence([args.source], args.windowStartMs, excluded);
  const ownerQuestions = listScopedOwnerQuestionEvidence([args.source], args.windowStartMs, excluded);
  const approvals = listScopedApprovalEvidence([args.source], args.windowStartMs, excluded);
  const deadLetterCounts = listDeadLetterCounts([args.source]);
  const deadLetters = listScopedDeadLetterEvidence([args.source], excluded);
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
  stateDir?: string;
  eventJournal?: EventJournal;
  trigger: WorkflowRunTrigger;
  now: Date;
}): ProgressReviewEvidencePacket {
  const payload = requestPayload(args.trigger);
  const windowMs = readWindowMs(payload);
  const endedAt = args.now.toISOString();
  const startedAtMs = args.now.getTime() - windowMs;
  const startedAt = new Date(startedAtMs).toISOString();
  const stateDir = args.stateDir ?? join(args.projectDir, ".kota");
  const target = selectEvidenceTarget(args.projectDir, args.trigger, stateDir);
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
  });
  const batch = batchSummary(args.trigger);
  const journalBackfillCount = events.filter(
    (event) => event.source === "journal",
  ).length;

  return {
    generatedAt: endedAt,
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
    taskClassDistribution: taskClassCounts,
    operatorJourneyRisks: journeyRisks,
    evidence,
    excluded: aggregateExcluded(scopes),
  };
}
