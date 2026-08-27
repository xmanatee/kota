import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { inspectResearchRetryCandidatesInWorker } from "./blocking-operations.js";
import {
  computeResourceFingerprint,
  evaluateCandidate,
  renderRetryMarker,
} from "./precondition.js";
import researchRetryWorkflow from "./workflow.js";

function bodyFromUrls(urls: string[]): string {
  return ["## Resources", "", ...urls.map((u) => `- ${u}`), ""].join("\n");
}

const roots: string[] = [];

function createResearchProject(
  candidates: Array<{ id: string; urls: string[]; marker?: string }> = [],
): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "research-retry-workflow-"));
  roots.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  writeFileSync(join(workspaceRoot, ".gitignore"), ".kota/\n");
  for (const candidate of candidates) {
    writeFileSync(
      join(workspaceRoot, "data", "tasks", `${candidate.id}.md`),
      [
        "---",
        "status: blocked",
        "priority: p2",
        "---",
        "",
        `# ${candidate.id}`,
        "",
        bodyFromUrls(candidate.urls),
        ...(candidate.marker ? ["", candidate.marker] : []),
        "",
      ].join("\n"),
    );
  }
  execFileSync("git", ["init", "--quiet"], { cwd: workspaceRoot });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["config", "user.name", "KOTA test"], {
    cwd: workspaceRoot,
  });
  execFileSync("git", ["add", "-A"], { cwd: workspaceRoot });
  execFileSync("git", ["commit", "--quiet", "-m", "scenario input"], {
    cwd: workspaceRoot,
  });
  return workspaceRoot;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function researchRetryTrigger(): WorkflowRunTrigger {
  return {
    event: "autonomy.blocked-research.attemptable",
    schemaRef: null,
    payload: {
      scopeId: "scope-research-retry",
      candidateCount: 1,
      attemptableCount: 1,
      counts: {
        open: 0,
        blocked: 1,
        done: 0,
        dropped: 0,
      },
    },
  };
}

describe("research-retry workflow", () => {
  it("wakes only from blocked research availability", () => {
    expect(researchRetryWorkflow.triggers.map((trigger) => trigger.event)).toEqual([
      "autonomy.blocked-research.attemptable",
    ]);
  });

  it("fails closed on unsupported triggers and malformed availability payloads", async () => {
    const validTrigger = researchRetryTrigger();
    const unsupported = await new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: {
        event: "runtime.idle",
        payload: validTrigger.payload,
      },
    }).run();
    expect(unsupported.steps["inspect-candidates"].error).toContain(
      "accepts only autonomy.blocked-research.attemptable triggers",
    );

    const malformed = await new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: {
        event: "autonomy.blocked-research.attemptable",
        payload: {},
      },
    }).run();
    expect(malformed.steps["inspect-candidates"].error).toContain(
      "payload must match autonomy.blocked-research.attemptable",
    );
  });

  it("runs task validation through the supervised command rail", async () => {
    const retryStep = researchRetryWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "retry" && step.type === "agent",
    );
    const check = retryStep?.repairLoop?.checks.find(
      (entry) => entry.id === "task-queue-valid",
    );
    if (!check || check.type !== "code") throw new Error("task-queue-valid missing");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "research-retry-command-"));
    const runCommand = vi.fn(successfulWorkflowCommandRun);

    await check.run(
      { workspaceRoot, runCommand } as unknown as WorkflowStepContext,
      {} as never,
    );

    expect(runCommand).toHaveBeenCalledWith({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: workspaceRoot,
    });
  });

  it("skips the agent step when there are no blocked research candidates", async () => {
    const workspaceRoot = createResearchProject();

    const harness = new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: researchRetryTrigger(),
      workspaceRoot,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-candidates"].output).toMatchObject({
      candidate: null,
      candidateCount: 0,
      examined: [],
    });
    expect(result.steps.retry.status).toBe("skipped");
    expect(result.steps["mark-attempt"].status).toBe("skipped");
  });

  it("skips the agent step when worktree is dirty", async () => {
    const workspaceRoot = createResearchProject([
      {
        id: "task-a",
        urls: ["https://example.com/article"],
      },
    ]);
    writeFileSync(join(workspaceRoot, "dirty.txt"), "uncommitted\n");

    const harness = new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: researchRetryTrigger(),
      workspaceRoot,
      workspaceDir: workspaceRoot,
    });

    const result = await harness.run();

    expect(result.steps.retry.status).toBe("skipped");
    expect(result.steps["mark-attempt"].status).toBe("skipped");
  });

  it("classifies candidates as unavailable when every URL lacks its capability", () => {
    const urls = [
      "https://x.com/akshay_pachaar/status/2041146899319971922",
      "https://openai.com/index/why-we-no-longer-evaluate/",
    ];
    expect(evaluateCandidate({
      urls,
      body: bodyFromUrls(urls),
      capability: {
        playwrightAvailable: false,
        authProfileConfigured: false,
        authProfileExists: false,
      },
    }).skipReason).toEqual({
      kind: "capability-absent",
      classes: ["x-post", "js-rendered"],
    });
  });

  it("classifies an unchanged URL fingerprint as already attempted", () => {
    const urls = [
      "https://example.com/research-a",
      "https://example.com/research-b",
    ];
    const fingerprint = computeResourceFingerprint(urls);
    const marker = renderRetryMarker({
      fingerprint,
      attemptedAt: "2026-04-22T23:47:08.339Z",
    });
    expect(evaluateCandidate({
      urls,
      body: `${bodyFromUrls(urls)}\n${marker}\n`,
      capability: {
        playwrightAvailable: false,
        authProfileConfigured: false,
        authProfileExists: false,
      },
    }).skipReason).toEqual({ kind: "no-change-since-last-attempt", fingerprint });
  });

  it("picks the next candidate when the oldest URL set was already attempted", () => {
    const staleUrls = ["https://example.com/stale"];
    const staleMarker = renderRetryMarker({
      fingerprint: computeResourceFingerprint(staleUrls),
      attemptedAt: "2026-04-14T00:00:00.000Z",
    });
    const freshUrls = ["https://example.com/article"];
    const workspaceRoot = createResearchProject([
      {
        id: "task-a-stale",
        urls: staleUrls,
        marker: staleMarker,
      },
      {
        id: "task-z-fresh",
        urls: freshUrls,
      },
    ]);
    const output = inspectResearchRetryCandidatesInWorker({ workspaceRoot });
    expect(output.candidate).toMatchObject({ id: "task-z-fresh" });
    expect(output.examined.map((e) => e.id)).toEqual(["task-a-stale"]);
  });

  it("picks the first stable task identity when capability is met", async () => {
    const workspaceRoot = createResearchProject([
      {
        id: "task-old",
        urls: ["https://example.com/old"],
      },
      {
        id: "task-new",
        urls: ["https://example.com/article"],
      },
    ]);
    const harness = new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: researchRetryTrigger(),
      workspaceRoot,
      stepOutputs: {
        retry: { content: "Research attempt completed." },
        "shadow-semantic-review": {
          decision: "pass",
          summary: "The source decision matches the task state.",
          citedArtifacts: ["metadata:inspect-candidates"],
          findings: [],
        },
      },
      ports: { runCommand: successfulWorkflowCommandRun },
    });

    const result = await harness.run();
    expect(result.steps["inspect-candidates"].output).toMatchObject({
      candidate: { id: "task-new" },
      candidateCount: 2,
    });
    expect(result.steps.retry.status).toBe("success");
    expect(result.steps["mark-attempt"].status).toBe("success");
  });

  it("writeMarkerForCandidate refreshes the marker after the agent edits resources", async () => {
    const { writeMarkerForCandidate, computeResourceFingerprint } = await import(
      "./precondition.js"
    );
    const workspaceRoot = mkdtempSync(join(tmpdir(), "research-retry-mark-"));
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: workspaceRoot,
      stdio: "ignore",
    });
    const blockedDir = join(workspaceRoot, "data", "tasks");
    mkdirSync(blockedDir, { recursive: true });
    const taskFile = join(blockedDir, "task-x.md");
    const initialUrls = [
      "https://x.com/foo/status/1",
      "https://openai.com/index/x/",
    ];
    writeFileSync(
      taskFile,
      [
        "---",
        "status: blocked",
        "priority: p2",
        "---",
        "",
        "# Task X",
        "## Problem",
        "Body",
        "",
        "## Resources",
        ...initialUrls.map((u) => `- ${u}`),
        "",
      ].join("\n"),
    );

    const result = writeMarkerForCandidate({
      workspaceRoot,
      candidateId: "task-x",
      attemptedAt: "2026-04-23T00:00:00.000Z",
    });

    expect(result.written).toBe(true);
    if (!result.written) throw new Error("expected written");
    expect(result.fingerprint).toBe(computeResourceFingerprint(initialUrls));
    const updated = readFileSync(taskFile, "utf8");
    expect(updated).toContain(
      `<!-- research-retry-attempt: fingerprint=${result.fingerprint} attempted_at=2026-04-23T00:00:00.000Z -->`,
    );
  });

  it("writeMarkerForCandidate is a no-op when the task moved out of blocked", async () => {
    const { writeMarkerForCandidate } = await import("./precondition.js");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "research-retry-mark-"));
    const doneDir = join(workspaceRoot, "data", "tasks", "archive");
    mkdirSync(doneDir, { recursive: true });
    const taskFile = join(doneDir, "task-y.md");
    writeFileSync(
      taskFile,
      [
        "---",
        "status: done",
        "---",
        "",
        "# Task Y",
        "## Problem",
        "Body",
        "",
        "## Resources",
        "- https://example.com/x",
        "",
      ].join("\n"),
    );

    const result = writeMarkerForCandidate({
      workspaceRoot,
      candidateId: "task-y",
    });

    expect(result.written).toBe(false);
    if (result.written) throw new Error("unexpected write");
    expect(result.reason).toBe("task moved to done");
  });
});
