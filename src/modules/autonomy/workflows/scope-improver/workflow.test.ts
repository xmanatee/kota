import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchFlushPayload,
} from "#core/workflow/trigger-types.js";
import {
  registerWorkflowDefinition,
  validateWorkflowDefinitions,
} from "#core/workflow/validation.js";
import {
  applyScopeImprovementRecommendations,
  collectScopeImprovementInputs,
  discoverScopeImprovementCandidates,
  gatherScopeImprovementEvidence,
  recommendScopeImprovements,
  SCOPE_IMPROVEMENT_ARTIFACT,
  SCOPE_IMPROVEMENT_SCHEDULE_EVENT,
} from "./scope-improvement.js";
import scopeImproverWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", async () => {
  const actual =
    await vi.importActual<typeof import("#core/util/repo-worktree.js")>(
      "#core/util/repo-worktree.js",
    );
  return {
    ...actual,
    getRepoWorktreeStatus: vi.fn(),
  };
});

vi.mock("#modules/autonomy/commit.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/commit.js")>(
      "#modules/autonomy/commit.js",
    );
  return {
    ...actual,
    commitWorkflowChanges: vi.fn(() => ({ committed: true })),
    checkCommitStageable: vi.fn(() => "ok"),
  };
});

vi.mock("#modules/autonomy/shared.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/shared.js")>(
      "#modules/autonomy/shared.js",
    );
  return {
    ...actual,
    runCheck: vi.fn(() => "ok"),
    checkNoScratchArtifacts: vi.fn(() => "ok"),
    checkCommitMessageExists: vi.fn(() => "ok"),
  };
});

const NOW = new Date("2026-06-04T12:00:00.000Z");

function makeScope(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-scope-improver-${label}-`));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  mkdirSync(join(dir, "data", "inbox"), { recursive: true });
  writeFileSync(join(dir, "data", "tasks", "AGENTS.md"), "# Tasks\n");
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function writeConfig(projectDir: string, config: object): void {
  mkdirSync(join(projectDir, ".kota", "scope-improvement"), { recursive: true });
  writeFileSync(
    join(projectDir, ".kota", "scope-improvement", "config.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

function writeRootAgents(projectDir: string): void {
  writeFileSync(
    join(projectDir, "AGENTS.md"),
    "# Scope\n\n- Keep improvements evidence-backed.\n",
  );
}

function trigger(files: string[]) {
  return {
    event: "files.changed",
    payload: { files, triggeredAt: NOW.toISOString() },
  };
}

function runCycle(projectDir: string, files: string[]) {
  const inputs = collectScopeImprovementInputs({
    projectDir,
    trigger: trigger(files),
    now: NOW,
  });
  const candidates = discoverScopeImprovementCandidates(inputs);
  const evidence = gatherScopeImprovementEvidence({ inputs, candidates });
  const recommendations = recommendScopeImprovements({ inputs, evidence });
  const actions = applyScopeImprovementRecommendations({
    projectDir,
    runId: "test-run",
    inputs,
    recommendations,
  });
  return { inputs, candidates, evidence, recommendations, actions };
}

describe("scope-improver workflow", () => {
  const projectDirs: string[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: false,
      trackedDirty: false,
      entries: [],
      fingerprint: "",
      summary: "clean",
      headSha: "abc1234",
    });
  });

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const dir = makeScope(label);
    projectDirs.push(dir);
    return dir;
  }

  it("declares manual, schedule, file, task, run, and recovery triggers", () => {
    const registered = validateWorkflowDefinitions([
      registerWorkflowDefinition(
        "src/modules/autonomy/workflows/scope-improver/workflow.ts",
        scopeImproverWorkflow,
      ),
    ])[0]!;

    expect(registered.triggers.map((item) => item.event)).toEqual([
      "autonomy.scope-improvement.requested",
      SCOPE_IMPROVEMENT_SCHEDULE_EVENT,
      "files.changed",
      "task.changed",
      "workflow.build.committed",
      "runtime.recovered",
    ]);
    expect(registered.triggers[2]?.watch).toContain("**/*.md");
  });

  it("runs the workflow and creates a review task from scoped file evidence", async () => {
    const projectDir = track("workflow");
    writeRootAgents(projectDir);
    writeConfig(projectDir, { minMinutesBetweenRuns: 0 });
    mkdirSync(join(projectDir, "notes"), { recursive: true });
    writeFileSync(join(projectDir, "notes", "plan.md"), "changed plan\n");

    const result = await new WorkflowTestHarness(scopeImproverWorkflow, {
      projectDir,
      trigger: trigger(["notes/plan.md"]),
    }).run();

    expect(result.status).toBe("success");
    const readyFiles = readdirSync(join(projectDir, "data", "tasks", "ready"))
      .filter((file) => file.endsWith(".md") && file !== "AGENTS.md");
    expect(readyFiles).toHaveLength(1);
    expect(readFileSync(join(projectDir, "data", "tasks", "ready", readyFiles[0]!), "utf-8"))
      .toContain("scope-improver workflow run harness-run-id");
    expect(
      existsSync(join(projectDir, ".kota", "runs", "harness", SCOPE_IMPROVEMENT_ARTIFACT)),
    ).toBe(true);
  });

  it("keeps scope state isolated and dedupes repeated recommendations", () => {
    const codeScope = track("code");
    const notesScope = track("notes");
    writeRootAgents(codeScope);
    writeConfig(codeScope, { minMinutesBetweenRuns: 0 });
    writeConfig(notesScope, {
      minMinutesBetweenRuns: 0,
      allowAutonomousEdits: true,
      writePaths: ["AGENTS.md"],
    });

    const first = runCycle(codeScope, ["src/app.ts"]);
    const second = runCycle(codeScope, ["src/app.ts"]);
    const other = runCycle(notesScope, ["plans/birthday.txt"]);

    expect(first.actions.createdTaskIds).toHaveLength(1);
    expect(second.recommendations[0]?.kind).toBe("skipped");
    expect(other.actions.safeEditPaths).toEqual(["AGENTS.md"]);
    const codeState = JSON.parse(
      readFileSync(join(codeScope, ".kota", "scope-improvement", "state.json"), "utf-8"),
    );
    const notesState = JSON.parse(
      readFileSync(join(notesScope, ".kota", "scope-improvement", "state.json"), "utf-8"),
    );
    expect(codeState.scopeId).toBe(deriveDirectoryScopeId(codeScope));
    expect(notesState.scopeId).toBe(deriveDirectoryScopeId(notesScope));
    expect(codeState.scopeId).not.toBe(notesState.scopeId);
  });

  it("throttles noisy file events before candidate discovery", () => {
    const projectDir = track("noisy");
    writeRootAgents(projectDir);
    const files = Array.from({ length: 31 }, (_, index) => `docs/${index}.md`);
    const inputs = collectScopeImprovementInputs({
      projectDir,
      trigger: trigger(files),
      now: NOW,
    });

    expect(inputs.throttle?.eventCount).toBe(31);
    expect(discoverScopeImprovementCandidates(inputs)).toEqual([]);
  });

  it("discovers root and nested AGENTS.md context for changed files", () => {
    const projectDir = track("context");
    writeRootAgents(projectDir);
    mkdirSync(join(projectDir, "docs"), { recursive: true });
    writeFileSync(join(projectDir, "docs", "AGENTS.md"), "# Docs\n");

    const inputs = collectScopeImprovementInputs({
      projectDir,
      trigger: trigger(["docs/plan.md"]),
      now: NOW,
    });

    expect(inputs.instructions.map((item) => item.path)).toEqual([
      "AGENTS.md",
      "docs/AGENTS.md",
    ]);
  });

  it("creates owner questions for missing guidance when edits are not allowed", () => {
    const projectDir = track("question");
    const result = runCycle(projectDir, ["plans/trip.txt"]);

    expect(result.actions.ownerQuestionIds).toHaveLength(1);
    const questionFiles = readdirSync(join(projectDir, ".kota", "owner-questions"));
    expect(questionFiles).toHaveLength(1);
    expect(
      readFileSync(join(projectDir, ".kota", "owner-questions", questionFiles[0]!), "utf-8"),
    ).toContain("What durable guidance should KOTA follow");
  });

  it("discovers task-queue review work from real task.changed batch flushes", () => {
    const projectDir = track("task-batch");
    writeRootAgents(projectDir);
    writeConfig(projectDir, { minMinutesBetweenRuns: 0 });
    const scopeId = deriveDirectoryScopeId(projectDir);
    const batchPayload = {
      scopeId,
      projectId: scopeId,
      sourceEventName: "task.changed",
      groupingKey: `projectId=${scopeId}`,
      reason: "count",
      count: 1,
      window: {
        firstEventAt: NOW.toISOString(),
        lastEventAt: NOW.toISOString(),
        flushedAt: NOW.toISOString(),
      },
      inputEvents: [
        {
          event: "task.changed",
          receivedAt: NOW.toISOString(),
          payload: {
            scopeId,
            projectId: scopeId,
            counts: { pending: 1, in_progress: 0, done: 0 },
          },
        },
      ],
      batch: {
        workflow: "scope-improver",
        triggerIndex: 3,
        maxBufferSize: 20,
        overflow: "flush-oldest",
        droppedInputCount: 0,
      },
    } satisfies WorkflowBatchFlushPayload;

    const inputs = collectScopeImprovementInputs({
      projectDir,
      trigger: {
        event: WORKFLOW_BATCH_FLUSH_EVENT,
        payload: batchPayload,
      },
      now: NOW,
    });
    const candidates = discoverScopeImprovementCandidates(inputs);

    expect(inputs.triggerKind).toBe("task");
    expect(candidates).toContainEqual(
      expect.objectContaining({ id: "task-queue-review" }),
    );
  });

  it("blocks safe edits outside the configured write paths", () => {
    const projectDir = track("guarded");
    writeConfig(projectDir, {
      minMinutesBetweenRuns: 0,
      allowAutonomousEdits: true,
      writePaths: ["docs/"],
    });

    const result = runCycle(projectDir, ["notes/reflection.txt"]);

    expect(result.recommendations[0]?.kind).toBe("safe-edit");
    expect(result.actions.safeEditPaths).toEqual([]);
    expect(result.actions.applied[0]).toMatchObject({
      kind: "skipped",
      reason: "policy does not allow autonomous edit of AGENTS.md",
    });
    expect(existsSync(join(projectDir, "AGENTS.md"))).toBe(false);
  });
});
