import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  OwnerQuestionAnswerBehavior,
  OwnerQuestionOrigin,
  OwnerQuestionStatus,
  PendingOwnerQuestion,
} from "#core/daemon/owner-question-queue.js";
import {
  detectRecurringOwnerInterventionPatternsFromReport,
  type OwnerInterventionEscalationConfig,
} from "./owner-intervention-escalation.js";
import { buildOwnerInterventionReport } from "./report/owner-interventions.js";

export const NOW = Date.parse("2026-06-24T12:00:00.000Z");
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CONFIG: OwnerInterventionEscalationConfig = {
  nowMs: NOW,
  windowMs: 7 * MS_PER_DAY,
  minQuestions: 2,
  minDistinctRuns: 2,
};

export type QuestionFixture = {
  id: string;
  status: OwnerQuestionStatus;
  runId?: string;
  taskId?: string | null;
  workflowName?: string;
  source?: string;
  createdAt?: string;
  resolvedAt?: string;
  answer?: string;
  proposedAnswers?: string[];
  answerBehavior?: OwnerQuestionAnswerBehavior;
  origin?: OwnerQuestionOrigin;
  timeoutMs?: number;
  resolutionSource?: string;
  omitOrigin?: boolean;
  omitAnswerBehavior?: boolean;
};

export function makeScopeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "owner-intervention-escalation-"));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  execFileSync("git", ["commit", "--allow-empty", "-m", "initial", "--quiet"], {
    cwd: dir,
  });
  return dir;
}

export function writeQuestion(workspaceRoot: string, fixture: QuestionFixture): void {
  const dir = join(workspaceRoot, ".kota", "owner-questions");
  mkdirSync(dir, { recursive: true });
  const origin: OwnerQuestionOrigin = fixture.origin ?? {
    kind: "workflow",
    workflowName: fixture.workflowName ?? "builder",
    runId: fixture.runId ?? `run-${fixture.id}`,
    stepId: "build",
    taskId: fixture.taskId === undefined ? "task-owner-pattern" : fixture.taskId,
  };
  const record: Partial<PendingOwnerQuestion> & {
    id: string;
    seq: number;
    context: string;
    question: string;
    reason: string;
    source: string;
    createdAt: string;
    status: OwnerQuestionStatus;
  } = {
    id: fixture.id,
    seq: 0,
    context: "Private prompt context API_KEY=sk-live-secret.",
    question: "Which path should the workflow take?",
    reason: "The workflow needs owner judgment before proceeding.",
    source: fixture.source ?? "ask-owner",
    createdAt: fixture.createdAt ?? new Date(NOW - MS_PER_DAY).toISOString(),
    status: fixture.status,
  };
  if (!fixture.omitAnswerBehavior) {
    record.answerBehavior = fixture.answerBehavior ?? "workflow-resume";
  }
  if (!fixture.omitOrigin) record.origin = origin;
  if (fixture.resolvedAt) record.resolvedAt = fixture.resolvedAt;
  if (fixture.answer) record.answer = fixture.answer;
  if (fixture.proposedAnswers) record.proposedAnswers = fixture.proposedAnswers;
  if (fixture.timeoutMs !== undefined) record.timeoutMs = fixture.timeoutMs;
  if (fixture.resolutionSource) record.resolutionSource = fixture.resolutionSource;
  writeFileSync(join(dir, `${fixture.id}.json`), JSON.stringify(record, null, 2));
}

export function ownerInterventionReport(workspaceRoot: string) {
  return buildOwnerInterventionReport({
    workspaceRoot,
    windowStartMs: NOW - 7 * MS_PER_DAY,
    windowEndMs: NOW,
  });
}

export function ownerInterventionDetection(workspaceRoot: string) {
  return detectRecurringOwnerInterventionPatternsFromReport({
    report: ownerInterventionReport(workspaceRoot),
    config: CONFIG,
  });
}
