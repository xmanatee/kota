import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import { OwnerDecisionStore } from "#core/daemon/owner-decision-store.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { stageGeneratedWorkProposal } from "#modules/autonomy/generated-work-proposal.js";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { resolveGeneratedWork } from "../progress-reviewer/progress-review/action-writers.js";
import { completeProgressReviewSemanticInput } from "../progress-reviewer/semantic-input.js";
import { emptyProgressReviewConsumptionState } from "../progress-reviewer/semantic-input-state.js";
import {
  inspectProgressSemanticBoundary,
  type ProgressBoundaryState,
} from "./semantic-reflection.js";

const boundaryStates = new Map<string, ProgressBoundaryState>();

function git(workspaceRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function taskFixture(args: {
  id: string;
  state: "open" | "blocked" | "done" | "dropped";
  priority?: "p0" | "p1" | "p2";
  strategic?: boolean;
}): string {
  return [
    "---",
    `status: ${args.state}`,
    ...(args.state === "open" || args.state === "blocked"
      ? [`priority: ${args.priority ?? "p2"}`]
      : []),
    "---",
    "",
    `# ${args.id}`,
    "",
    "## Problem",
    "",
    "Fixture task.",
    ...(args.state === "blocked" ? ["", "## Blocked on", "kind: operator-capture", "path: evidence", "description: Required operator evidence is unavailable"] : []),
    ...(args.strategic ? ["", "## Initiative", "", "Semantic reflection."] : []),
    "",
  ].join("\n");
}

function write(workspaceRoot: string, path: string, content: string): void {
  const absolute = join(workspaceRoot, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function writeTask(
  workspaceRoot: string,
  state: "open" | "blocked" | "done" | "dropped",
  id: string,
  options: Omit<Parameters<typeof taskFixture>[0], "id" | "state"> = {},
): void {
  write(
    workspaceRoot,
    state === "done" || state === "dropped"
      ? `data/tasks/archive/${id}.md`
      : `data/tasks/${id}.md`,
    taskFixture({ id, state, ...options }),
  );
}

function moveTask(
  workspaceRoot: string,
  id: string,
  from: "open" | "blocked" | "done" | "dropped",
  to: "open" | "blocked" | "done" | "dropped",
  options: Omit<Parameters<typeof taskFixture>[0], "id" | "state"> = {},
): void {
  const fromPath = join(
    workspaceRoot,
    "data",
    "tasks",
    ...(from === "done" || from === "dropped" ? ["archive"] : []),
    `${id}.md`,
  );
  const toPath = join(
    workspaceRoot,
    "data",
    "tasks",
    ...(to === "done" || to === "dropped" ? ["archive"] : []),
    `${id}.md`,
  );
  if (fromPath !== toPath) renameSync(fromPath, toPath);
  writeFileSync(toPath, taskFixture({ id, state: to, ...options }), "utf8");
}

function makeProject(label: string): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `kota-semantic-reflection-${label}-`));
  const authority = new RunStateDatabase(join(workspaceRoot, ".kota"));
  authority.registerScope({ id: deriveDirectoryScopeId(workspaceRoot), rootPath: workspaceRoot, createdAt: new Date().toISOString() });
  authority.close();
  mkdirSync(join(workspaceRoot, "data", "tasks", "archive"), { recursive: true });
  mkdirSync(join(workspaceRoot, "data", "inbox"), { recursive: true });
  write(workspaceRoot, ".gitignore", ".kota/\n");
  git(workspaceRoot, ["init", "--quiet"]);
  return workspaceRoot;
}

function commit(workspaceRoot: string, message: string): void {
  git(workspaceRoot, ["add", "."]);
  git(workspaceRoot, [
    "-c",
    "user.email=kota@example.test",
    "-c",
    "user.name=KOTA Test",
    "commit",
    "--quiet",
    "--no-gpg-sign",
    "-m",
    message,
  ]);
}

async function inspect(workspaceRoot: string, scopeRoot = workspaceRoot, consumedRevision = 0) {
  const result = await inspectProgressSemanticBoundary({
    workspaceRoot,
    scopeRoot,
    stateDir: join(scopeRoot, ".kota"),
    runtimeStateDir: join(scopeRoot, ".kota"),
    progressBoundaryState: boundaryStates.get(workspaceRoot) ?? null,
    consumedRevision,
    runCommand: runGitEvidenceCommand,
  });
  if (result.nextState !== null) boundaryStates.set(workspaceRoot, result.nextState);
  return result;
}

function recordOutcome(root: string, id: string, status: "success" | "failed", observer = false): void {
  const startedAt = "2026-09-01T10:00:00.000Z";
  const completedAt = "2026-09-01T10:01:00.000Z";
  write(root, `.kota/runs/${id}/metadata.json`, JSON.stringify({
    metadataVersion: 1, id, workflow: observer ? "progress-reviewer" : "builder", definitionPath: "workflow.ts",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    startedAt, completedAt, status, runDir: join(root, ".kota", "runs", id),
    tags: observer ? ["systemic-observer"] : [],
    steps: [{ id: "build", type: "agent", status, startedAt, completedAt, durationMs: 60_000,
      ...(status === "failed" ? { errorKind: "output-validation" } : {}), usage: UNKNOWN_AGENT_USAGE }],
  }));
}

describe("semantic progress reflection", () => {
  const scopeRoots: string[] = [];

  afterEach(() => {
    boundaryStates.clear();
    for (const workspaceRoot of scopeRoots.splice(0)) {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  function track(label: string): string {
    const workspaceRoot = makeProject(label);
    scopeRoots.push(workspaceRoot);
    return workspaceRoot;
  }

  it("parks a clean isolated snapshot while the canonical scope is dirty", async () => {
    const scopeRoot = track("dirty-canonical");
    write(scopeRoot, "README.md", "# Canonical\n");
    commit(scopeRoot, "seed canonical scope");
    write(scopeRoot, "owner-draft.txt", "not committed\n");

    const workspaceRoot = track("clean-snapshot");
    write(workspaceRoot, "README.md", "# Snapshot\n");
    commit(workspaceRoot, "seed isolated snapshot");

    await expect(inspect(workspaceRoot, scopeRoot)).resolves.toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("canonical worktree is clean"),
    });
  });

  it("retains a single delivery and source growth without launching per-build reviews", async () => {
    const workspaceRoot = track("parked-build-restraint");
    writeTask(workspaceRoot, "open", "task-delivery");
    writeTask(workspaceRoot, "blocked", "task-strategic-anchor");
    commit(workspaceRoot, "seed actionable queue");
    expect((await inspect(workspaceRoot)).shouldEmit).toBe(false);

    moveTask(workspaceRoot, "task-delivery", "open", "done");
    commit(workspaceRoot, "complete delivery task");
    const parked = await inspect(workspaceRoot);
    expect(parked).toMatchObject({ shouldEmit: false, reason: expect.stringContaining("evidence-insufficient") });
    const baseline = parked.nextState!.baseline.head;

    for (let index = 1; index <= 5; index += 1) {
      write(workspaceRoot, `src/build-${index}.ts`, `export const build${index} = ${index};\n`);
      commit(workspaceRoot, `successful build ${index}`);
      expect(await inspect(workspaceRoot)).toMatchObject({
        shouldEmit: false,
        reason: expect.stringContaining("evidence-insufficient"),
        nextState: { baseline: { head: baseline } },
      });
    }
  });

  it("emits a task-disposition boundary when a task becomes blocked", async () => {
    const workspaceRoot = track("blocked");
    writeTask(workspaceRoot, "open", "task-needs-input");
    commit(workspaceRoot, "seed open task");
    await inspect(workspaceRoot);

    moveTask(workspaceRoot, "task-needs-input", "open", "blocked");
    commit(workspaceRoot, "block task");
    expect(await inspect(workspaceRoot)).toMatchObject({
      shouldEmit: true,
      payload: {
        boundary: "task-disposition",
        inputRevision: 1,
        evidenceRefs: expect.arrayContaining([
          "data/tasks/task-needs-input.md",
        ]),
      },
    });
  });

  it("emits once when an owner decision resolves even with a full delivery backlog", async () => {
    const workspaceRoot = track("owner-decision");
    write(workspaceRoot, "README.md", "# Fixture\n");
    for (let index = 0; index < 10; index++) writeTask(workspaceRoot, "open", `task-independent-${index}`);
    commit(workspaceRoot, "seed fixture");
    await inspect(workspaceRoot);

    const store = new OwnerDecisionStore(
      join(workspaceRoot, ".kota", "owner-decisions"), deriveDirectoryScopeId(workspaceRoot),
    );
    const decision = store.create({
      request: { kind: "single-choice", prompt: "Choose direction", options: [{ id: "proceed", label: "Proceed" }] },
      requester: { kind: "workflow", workflowName: "builder", runId: "owner-reflection", stepId: "ask", taskId: null },
      evidence: [],
    });
    store.answer(decision.id, { kind: "single-choice", optionId: "proceed" }, "operator");
    const resolved = await inspect(workspaceRoot);
    expect(resolved).toMatchObject({
      shouldEmit: true,
      payload: {
        boundary: "owner-decision-resolution",
        inputRevision: 1,
        evidenceRefs: [`.kota/owner-decisions/${decision.id}.json`],
      },
    });
    expect((await inspect(workspaceRoot)).shouldEmit).toBe(false);
  });

  it("does not use task labels or priority as evidence sufficiency", async () => {
    const workspaceRoot = track("strategic-completion");
    writeTask(workspaceRoot, "open", "task-milestone", {
      priority: "p1",
      strategic: true,
    });
    commit(workspaceRoot, "seed strategic task");
    await inspect(workspaceRoot);

    moveTask(workspaceRoot, "task-milestone", "open", "done", {
      priority: "p1",
      strategic: true,
    });
    commit(workspaceRoot, "complete strategic milestone");
    expect(await inspect(workspaceRoot)).toMatchObject({
      shouldEmit: false,
      reason: expect.stringContaining("evidence-insufficient"),
    });
  });
  it("coalesces independent deliveries while builders have work and consumes a pinned decision only after publication", async () => {
    const root = track("coalesced-delivery");
    writeTask(root, "open", "task-one");
    writeTask(root, "open", "task-two");
    for (const id of ["task-three", "task-four", "task-five", "task-six"]) writeTask(root, "open", id);
    commit(root, "seed independent work");
    const baseline = (await inspect(root)).nextState!.baseline.head;
    moveTask(root, "task-one", "open", "done");
    commit(root, "deliver first outcome");
    expect(await inspect(root)).toMatchObject({ shouldEmit: false, reason: expect.stringContaining("builder work has priority"), nextState: { baseline: { head: baseline } } });
    moveTask(root, "task-two", "open", "done");
    commit(root, "deliver second outcome");
    expect((await inspect(root)).shouldEmit).toBe(false);
    for (const id of ["task-three", "task-four", "task-five", "task-six"]) moveTask(root, id, "open", "done");
    commit(root, "finish independent batch");
    const admitted = await inspect(root);
    expect(admitted).toMatchObject({ shouldEmit: true, payload: { boundary: "evidence-window", inputRevision: 1, evidenceWindow: { fromHead: baseline } } });
    // Persisted state, not an in-memory event count, owns reservation.
    const saved = join(root, ".kota", "boundary-restart.json");
    writeFileSync(saved, JSON.stringify(admitted.nextState));
    boundaryStates.set(root, JSON.parse(readFileSync(saved, "utf8")));
    expect(await inspect(root)).toMatchObject({ shouldEmit: false, reason: expect.stringContaining("reserved") });
    const consumed = completeProgressReviewSemanticInput({ current: emptyProgressReviewConsumptionState(root), input: { automatic: true, inputRevision: 1 }, consumedAt: new Date().toISOString() });
    expect(await inspect(root, root, consumed.lastConsumedRevision)).toMatchObject({ shouldEmit: false, nextState: { pending: null } });
    expect((await inspect(root, root, consumed.lastConsumedRevision)).shouldEmit).toBe(false);
  });

  it("compares repeated failures despite a full backlog and keeps review churn from driving another decision", async () => {
    const root = track("failure-cohort");
    write(root, "README.md", "# Scope\n");
    for (let index = 0; index < 10; index++) writeTask(root, "open", `task-independent-${index}`);
    commit(root, "seed scope");
    await inspect(root);
    recordOutcome(root, "failure-one", "failed");
    expect((await inspect(root)).shouldEmit).toBe(false);
    recordOutcome(root, "failure-two", "failed");
    expect(await inspect(root)).toMatchObject({ shouldEmit: true, payload: { evidenceWindow: { current: expect.arrayContaining([expect.objectContaining({ id: "failure-one" }), expect.objectContaining({ id: "failure-two" })]) } } });
    await inspect(root, root, 1);
    recordOutcome(root, "review-of-review", "failed", true);
    expect((await inspect(root, root, 1)).shouldEmit).toBe(false);
  });

  it("retains a review's integrated retirement without admitting a review of that review", async () => {
    const root = track("retirement");
    writeTask(root, "open", "task-independent");
    const proposalKey = "improvement:disproved-proposal";
    const staged = stageGeneratedWorkProposal({ workspaceRoot: root, proposal: {
      kind: "task", proposalKey, title: "Investigate delivery failures", priority: "p2",
      body: "## Problem\n\nDelivery failures may share a cause.\n",
      provenance: { source: "progress-reviewer", runId: "original-review", evidenceRefs: ["run:failure"] },
    } });
    commit(root, "integrate proposed investigation");
    recordOutcome(root, "failure-one", "failed");
    recordOutcome(root, "failure-two", "failed");
    expect((await inspect(root)).shouldEmit).toBe(true);
    await inspect(root, root, 1);

    resolveGeneratedWork({ workspaceRoot: root, resolution: {
      topicKey: proposalKey, reason: "Independent evidence disproved the common cause", evidenceIds: ["run:counterevidence"],
    } });
    commit(root, "integrate reviewer retirement");
    recordOutcome(root, "review-resolution", "success", true);
    const quiet = await inspect(root, root, 1);
    expect(quiet).toMatchObject({ shouldEmit: false, reason: expect.stringContaining("evidence-insufficient") });
    boundaryStates.set(root, JSON.parse(JSON.stringify(quiet.nextState)));
    expect((await inspect(root, root, 1)).shouldEmit).toBe(false);

    moveTask(root, "task-independent", "open", "blocked");
    commit(root, "independent task needs owner input");
    expect(await inspect(root, root, 1)).toMatchObject({ shouldEmit: true, payload: {
      boundary: "task-disposition", inputRevision: 2,
      evidenceRefs: expect.arrayContaining([`data/tasks/archive/${staged.taskId}.md`, "data/tasks/task-independent.md"]),
    } });
  });

  it("admits changed recovery yield in spare capacity once, then keeps steady healthy outcomes quiet", async () => {
    const root = track("recovery-yield");
    writeTask(root, "open", "task-independent");
    commit(root, "seed independent work");
    recordOutcome(root, "baseline-failure", "failed");
    recordOutcome(root, "baseline-success", "success");
    expect((await inspect(root)).shouldEmit).toBe(true);
    await inspect(root, root, 1);
    recordOutcome(root, "recovered-one", "success");
    expect((await inspect(root, root, 1)).shouldEmit).toBe(false);
    recordOutcome(root, "recovered-two", "success");
    const recovery = await inspect(root, root, 1);
    expect(recovery).toMatchObject({ shouldEmit: true, payload: {
      boundary: "evidence-window", inputRevision: 2,
      evidenceWindow: { current: [expect.objectContaining({ status: "success" }), expect.objectContaining({ status: "success" })] },
    } });
    boundaryStates.set(root, JSON.parse(JSON.stringify(recovery.nextState)));
    expect((await inspect(root, root, 1)).shouldEmit).toBe(false);
    await inspect(root, root, 2);
    for (let index = 0; index < 6; index++) {
      recordOutcome(root, `healthy-${index}`, "success");
      expect((await inspect(root, root, 2)).shouldEmit).toBe(false);
    }
  });

  it("retains a delivery boundary for unheld inbox work but admits it once that inbox is retained", async () => {
    const root = track("held-inbox");
    for (const id of ["task-first", "task-second"]) writeTask(root, "open", id);
    write(root, "data/inbox/task-capture.md", "Investigate a captured failure.\n");
    commit(root, "seed work and capture");
    expect((await inspect(root)).shouldEmit).toBe(false);
    for (const id of ["task-first", "task-second"]) moveTask(root, id, "open", "done");
    commit(root, "deliver both outcomes");
    expect((await inspect(root)).shouldEmit).toBe(false);

    const database = new RunStateDatabase(join(root, ".kota"));
    const now = new Date().toISOString();
    const { epoch } = database.beginDaemonSession(now);
    database.admitRun({ id: "held-sorter", scopeId: deriveDirectoryScopeId(root), workflow: "inbox-sorter", repository: "write",
      trigger: { event: "autonomy.inbox.available", schemaRef: null, payload: {} },
      resources: ["autonomy:inbox-triage"], admittedAt: now });
    database.startRun("held-sorter", epoch, now);
    database.suspendRun({ runId: "held-sorter", epoch, state: "waiting", suspendedAt: now });
    database.close();
    write(root, ".kota/runs/held-sorter/metadata.json", JSON.stringify({
      metadataVersion: 1, id: "held-sorter", workflow: "inbox-sorter", definitionPath: "workflow.ts",
      trigger: { event: "autonomy.inbox.available", schemaRef: null, payload: {} },
      startedAt: now, completedAt: now, status: "interrupted", runDir: ".kota/runs/held-sorter", steps: [],
    }));
    expect(await inspect(root)).toMatchObject({ shouldEmit: true, payload: { boundary: "evidence-window", inputRevision: 1 } });
    expect((await inspect(root)).shouldEmit).toBe(false);
    expect((await inspect(root, root, 1)).shouldEmit).toBe(false);
  });

});
