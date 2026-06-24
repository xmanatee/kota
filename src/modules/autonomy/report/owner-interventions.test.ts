import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildOwnerInterventionReport } from "./owner-interventions.js";

const NOW = Date.parse("2026-04-29T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type QuestionFixture = {
  id: string;
  status: "pending" | "answered" | "dismissed" | "expired";
  createdAt?: string;
  resolvedAt?: string;
  answer?: string;
  proposedAnswers?: string[];
  source?: string;
  answerBehavior?: "workflow-resume" | "record-only" | "unknown";
  origin?: Record<string, unknown>;
  timeoutMs?: number;
  resolutionSource?: string;
  omitOrigin?: boolean;
  omitAnswerBehavior?: boolean;
};

function writeQuestion(projectDir: string, fixture: QuestionFixture): void {
  const dir = join(projectDir, ".kota", "owner-questions");
  mkdirSync(dir, { recursive: true });
  const record: Record<string, unknown> = {
    id: fixture.id,
    seq: 0,
    context: "Prompt context with private operator details.",
    question: "Which path should the workflow take?",
    reason: "The workflow needs owner judgment before proceeding.",
    source: fixture.source ?? "test-source",
    createdAt: fixture.createdAt ?? new Date(NOW - MS_PER_DAY).toISOString(),
    status: fixture.status,
  };
  if (!fixture.omitAnswerBehavior) {
    record.answerBehavior = fixture.answerBehavior ?? "workflow-resume";
  }
  if (!fixture.omitOrigin) {
    record.origin = fixture.origin ?? {
      kind: "workflow",
      workflowName: "builder",
      runId: "2026-04-29T10-00-00-000Z-builder-abc",
      stepId: "build",
      taskId: "task-owner-intervention",
    };
  }
  if (fixture.resolvedAt) record.resolvedAt = fixture.resolvedAt;
  if (fixture.answer) record.answer = fixture.answer;
  if (fixture.proposedAnswers) record.proposedAnswers = fixture.proposedAnswers;
  if (fixture.timeoutMs !== undefined) record.timeoutMs = fixture.timeoutMs;
  if (fixture.resolutionSource) record.resolutionSource = fixture.resolutionSource;
  writeFileSync(join(dir, `${fixture.id}.json`), JSON.stringify(record, null, 2));
}

describe("buildOwnerInterventionReport", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `owner-interventions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function report() {
    return buildOwnerInterventionReport({
      projectDir,
      windowStartMs: NOW - 7 * MS_PER_DAY,
      windowEndMs: NOW,
    });
  }

  it("classifies answers that match proposed answers as proposed-option", () => {
    writeQuestion(projectDir, {
      id: "proposed1",
      status: "answered",
      resolvedAt: new Date(NOW - 60_000).toISOString(),
      proposedAnswers: ["Proceed with the focused fix"],
      answer: "Proceed with the focused fix.",
    });

    const data = report();

    expect(data.answered).toBe(1);
    expect(data.records[0]).toMatchObject({
      questionId: "proposed1",
      outcomeBucket: "proposed-option",
      workflowName: "builder",
      taskId: "task-owner-intervention",
    });
    expect(data.byStatus).toEqual([{ status: "answered", count: 1 }]);
    expect(data.byAnswerBehavior).toEqual([
      { answerBehavior: "workflow-resume", count: 1 },
    ]);
    expect(data.bySource[0]).toMatchObject({ key: "test-source", total: 1 });
    expect(data.byWorkflow[0]).toMatchObject({ key: "builder", total: 1 });
    expect(data.byTask[0]).toMatchObject({
      key: "task-owner-intervention",
      total: 1,
    });
  });

  it("classifies free-form correction answers that do not match proposed options", () => {
    writeQuestion(projectDir, {
      id: "correct1",
      status: "answered",
      resolvedAt: new Date(NOW - 60_000).toISOString(),
      proposedAnswers: ["Keep the current queue order"],
      answer: "No, use the blocked-promoter path instead.",
    });

    const data = report();

    expect(data.answeredCorrections).toBe(1);
    expect(data.records[0]?.outcomeBucket).toBe("freeform-correction");
    expect(data.byOutcome).toEqual([
      { outcome: "freeform-correction", count: 1 },
    ]);
  });

  it("reports expired timeout pressure separately from answered corrections", () => {
    writeQuestion(projectDir, {
      id: "timeout1",
      status: "expired",
      resolvedAt: new Date(NOW - 60_000).toISOString(),
      resolutionSource: "timeout",
      timeoutMs: 10 * 60 * 1000,
    });

    const data = report();

    expect(data.timeouts).toBe(1);
    expect(data.answeredCorrections).toBe(0);
    expect(data.records[0]?.markers).toContain("resolved-by-timeout");
  });

  it("reports pending questions past their timeout as stale pending", () => {
    writeQuestion(projectDir, {
      id: "stale1",
      status: "pending",
      createdAt: new Date(NOW - 2 * MS_PER_DAY).toISOString(),
      timeoutMs: 60 * 60 * 1000,
    });

    const data = report();

    expect(data.pending).toBe(1);
    expect(data.stalePending).toBe(1);
    expect(data.timeouts).toBe(0);
    expect(data.records[0]?.markers).toContain("stale-pending");
  });

  it("normalizes legacy records without origin or answerBehavior as unknown", () => {
    writeQuestion(projectDir, {
      id: "legacy1",
      status: "dismissed",
      resolvedAt: new Date(NOW - 60_000).toISOString(),
      omitOrigin: true,
      omitAnswerBehavior: true,
    });

    const data = report();

    expect(data.legacyUnknown).toBe(1);
    expect(data.records[0]).toMatchObject({
      originKind: "manual",
      workflowName: null,
      answerBehavior: "unknown",
      outcomeBucket: "not-answered",
    });
    expect(data.records[0]?.markers).toEqual([
      "legacy-origin",
      "legacy-answer-behavior",
    ]);
  });

  it("does not include raw prompts, answers, secrets, or cost fields in records", () => {
    writeQuestion(projectDir, {
      id: "secret1",
      status: "answered",
      resolvedAt: new Date(NOW - 60_000).toISOString(),
      answer: "Use API_KEY=sk-live-secret instead.",
      proposedAnswers: ["Continue"],
    });

    const data = report();
    const serialized = JSON.stringify(data);

    expect(serialized).toContain("owner-question:secret1");
    expect(serialized).not.toContain("Prompt context");
    expect(serialized).not.toContain("Which path should");
    expect(serialized).not.toContain("sk-live-secret");
    expect(serialized).not.toMatch(/cost/i);
  });
});
