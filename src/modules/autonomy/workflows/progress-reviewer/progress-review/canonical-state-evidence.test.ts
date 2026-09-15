import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { deriveDirectoryScopeId, ScopeRegistry } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { applyAutonomyIssueObservations, buildAutonomyIssueObservation, emptyAutonomyIssueProjection, recordAutonomyIssueDispositions } from "#modules/autonomy/autonomy-issue-projection.js";
import { progressReviewRequested } from "../events.js";
import {
  makeProgressReviewScopeRoot,
  NOW,
} from "../workflow.test-helpers.js";
import { compactProgressReviewEvidenceForAgent } from "./agent-packet.js";
import { collectProgressReviewEvidence } from "./collect.js";

function task(args: {
  id: string;
  dependsOn?: string[];
}): string {
  return [
    "---",
    "status: open",
    "priority: p2",
    ...(args.dependsOn ? [`depends_on: [${args.dependsOn.join(", ")}]`] : []),
    "---",
    "",
    `# ${args.id}`,
    "",
    "## Problem",
    "",
    "Canonical queue fixture.",
    "",
  ].join("\n");
}

describe("progress-reviewer canonical state evidence", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("reads hosted SQLite authority without moving scope-local evidence into the daemon root", () => {
    const scopeRoot = makeProgressReviewScopeRoot("progress-hosted-authority");
    scopeRoots.push(scopeRoot);
    const stateDir = join(scopeRoot, ".kota");
    const runtimeStateDir = join(scopeRoot, "daemon-state");
    const workspaceRoot = join(scopeRoot, "sandbox");
    mkdirSync(workspaceRoot);
    const scopeId = deriveDirectoryScopeId(scopeRoot);
    new ScopeRegistry({ stateDir: runtimeStateDir, scopes: [{ scopeRoot }] });
    const database = new RunStateDatabase(runtimeStateDir);
    database.registerScope({ id: scopeId, rootPath: scopeRoot, createdAt: NOW.toISOString() });
    database.admitRun({
      id: "hosted-pending", scopeId, workflow: "builder", repository: "read",
      trigger: { event: "manual", schemaRef: null, payload: {} }, resources: [],
      admittedAt: NOW.toISOString(),
    });
    database.close();
    mkdirSync(join(stateDir, "runs", "scope-evidence"), { recursive: true });
    writeFileSync(join(stateDir, "runs", "scope-evidence", "metadata.json"), JSON.stringify({
      id: "scope-evidence", workflow: "builder", definitionPath: "workflow.ts",
      trigger: { event: "manual", schemaRef: null, payload: {} }, status: "success",
      startedAt: NOW.toISOString(), completedAt: NOW.toISOString(),
      runDir: ".kota/runs/scope-evidence", steps: [],
    }));

    const evidence = collectProgressReviewEvidence({
      workspaceRoot, scopeRoot, stateDir, runtimeStateDir,
      trigger: { event: progressReviewRequested.name, schemaRef: null, payload: {} }, now: NOW,
    });
    expect(evidence.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "run:hosted-pending", status: "pending" }),
    ]));
    expect(evidence.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "run:scope-evidence", status: "success" }),
    ]));
    expect(evidence.canonicalState.find((item) => item.id === "state:queue")?.summary)
      .toContain("ownershipAvailable=true");
  });

  it("keeps the pinned outcome comparison in default input when raw semantic references overflow", () => {
    const workspaceRoot = makeProgressReviewScopeRoot("progress-compact-comparison");
    scopeRoots.push(workspaceRoot);
    const baseline = {
      id: "before", workflow: "builder", status: "failed", delivery: null,
      startedAt: "2026-05-01T00:00:00.000Z", completedAt: "2026-05-01T01:00:00.000Z",
      errors: ["critic-rejection"], observationOnly: false,
    };
    const evidence = collectProgressReviewEvidence({
      workspaceRoot, scopeRoot: workspaceRoot, stateDir: join(workspaceRoot, ".kota"), runtimeStateDir: join(workspaceRoot, ".kota"),
      trigger: { event: progressReviewRequested.name, schemaRef: null, payload: {} }, now: NOW,
      semanticInput: {
        automatic: true, shouldReview: true, inputRevision: 1, deliveryAttempt: 0,
        boundary: "evidence-window", reason: "Delivery recovered after an intervention",
        evidenceRefs: Array.from({ length: 12 }, (_, i) => `.kota/runs/run-${i}/metadata.json`),
        evidenceWindow: {
          fromHead: "a".repeat(40), toHead: "b".repeat(40),
          startedAt: baseline.startedAt, endedAt: NOW.toISOString(),
          baseline: [baseline], current: [{ ...baseline, id: "after", status: "success", errors: [], delivery: "delivered" }],
          excluded: ["one unavailable run"],
        },
      },
    });
    const compact = compactProgressReviewEvidenceForAgent(evidence);
    const comparison = compact.evidence.find((entry) => entry.id === "state:systemic-window");
    expect(comparison).toEqual(evidence.evidence.find((entry) => entry.id === "state:systemic-window"));
    expect(comparison?.summary).toContain("Historical baseline: builder/failed/delivery=unavailable/errors=critic-rejection: 1");
    expect(comparison?.summary).toContain("New or revised outcomes: builder/success/delivery=delivered/errors=none: 1");
    expect(comparison?.summary).toContain("one unavailable run");
    expect(comparison?.summary).toContain(baseline.startedAt);
    expect(comparison?.path).toBe("progress-review-evidence.json");
    expect(compact.evidence.length).toBeLessThan(evidence.evidence.length);
    expect(compact.semanticInput.evidenceWindow).toBeUndefined();
    expect(compact.excluded.some((entry) => entry.includes("omitted"))).toBe(true);
  });

  it("keeps the complete open queue while the compact agent packet points to canonical refs", () => {
    const workspaceRoot = makeProgressReviewScopeRoot("progress-canonical-queue");
    scopeRoots.push(workspaceRoot);
    for (let index = 0; index < 25; index += 1) {
      const id = `task-open-${String(index).padStart(2, "0")}`;
      writeFileSync(
        join(workspaceRoot, "data", "tasks", `${id}.md`),
        task({
          id,
          dependsOn: index === 1 ? ["task-open-00"] : undefined,
        }),
      );
    }

    const evidence = collectProgressReviewEvidence({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"), runtimeStateDir: join(workspaceRoot, ".kota"),
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { reason: "inspect canonical queue" },
      },
      now: NOW,
    });
    expect(evidence.tasks.filter((item) => item.state === "open"))
      .toHaveLength(25);
    expect(evidence.tasks.find((item) => item.taskId === "task-open-00"))
      .toMatchObject({ dependsOn: [], waitingOn: [] });
    expect(evidence.tasks.find((item) => item.taskId === "task-open-01"))
      .toMatchObject({
        dependsOn: ["task-open-00"],
        waitingOn: ["task-open-00"],
      });
    expect(evidence.excluded.some((entry) => entry.includes("open queue")))
      .toBe(false);

    const compact = compactProgressReviewEvidenceForAgent(evidence);
    expect(compact.evidence.filter((item) => item.kind === "task")).toHaveLength(20);
    expect(compact.evidence).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "state:queue",
        kind: "state",
        path: "data/tasks/",
      }),
      expect.objectContaining({ id: "state:autonomy-issues", kind: "state" }),
      expect.objectContaining({ id: "state:recovery", kind: "state" }),
      expect.objectContaining({ id: "state:owner-decisions", kind: "state" }),
    ]));
  });

  it("exports redacted issue ownership and owner decisions in the readable packet", () => {
    const workspaceRoot = makeProgressReviewScopeRoot("progress-state-details");
    scopeRoots.push(workspaceRoot);
    const stateDir = join(workspaceRoot, ".kota");
    const scopeId = deriveDirectoryScopeId(workspaceRoot);
    const observation = buildAutonomyIssueObservation({
      kind: "present", rootCauseKey: "delivery:failure", observedAt: NOW.toISOString(), signalIds: ["failure"],
      source: { kind: "workflow", id: "builder" }, severity: "error", actionability: "local-code",
      labels: [], summaries: ["Delivery failed with Bearer secret-example-value"], evidenceRefs: [], observationCount: 1,
    });
    const observed = applyAutonomyIssueObservations({ current: emptyAutonomyIssueProjection(), observations: [observation] }).projection;
    const projection = recordAutonomyIssueDispositions({ current: observed, updates: [{
      issueKey: observation.issueKey, semanticRevision: 1, kind: "task", decidedAt: NOW.toISOString(), taskIds: ["task-repair-delivery"], ownerQuestionIds: [],
    }] });
    const decisions = new OwnerDecisionStore(join(stateDir, "owner-decisions"), scopeId);
    const decision = decisions.create({ request: { kind: "single-choice", prompt: "Choose direction", options: [{ id: "repair", label: "Repair delivery" }] }, requester: { kind: "manual", source: "owner" }, evidence: [] });
    decisions.answer(decision.id, { kind: "single-choice", optionId: "repair" }, "operator");
    const evidence = collectProgressReviewEvidence({ workspaceRoot, scopeRoot: workspaceRoot, stateDir, runtimeStateDir: stateDir, now: NOW,
      trigger: { event: progressReviewRequested.name, schemaRef: null, payload: {} }, autonomyIssueProjection: projection });
    const issue = evidence.canonicalState.find((ref) => ref.id === `state:issue:${observation.issueKey}`)!;
    expect(JSON.parse(issue.summary)).toMatchObject({ disposition: { kind: "task" }, links: { taskIds: ["task-repair-delivery"] } });
    expect(issue.summary).not.toContain("secret-example-value");
    const choice = evidence.canonicalState.find((ref) => ref.id === `state:owner-decision:${decision.id}`)!;
    expect(JSON.parse(choice.summary)).toMatchObject({ status: "answered", selectedValue: { optionId: "repair" } });
    expect([issue.path, choice.path]).toEqual(["progress-review-evidence.json", "progress-review-evidence.json"]);
    expect(evidence.canonicalState.some((ref) => ref.path?.includes("kota.sqlite"))).toBe(false);
  });
});
