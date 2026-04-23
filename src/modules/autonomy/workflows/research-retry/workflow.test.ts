import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import researchRetryWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
}));

vi.mock("./candidates.js", async () => {
  const actual = await vi.importActual<typeof import("./candidates.js")>(
    "./candidates.js",
  );
  return {
    ...actual,
    listResearchRetryCandidates: vi.fn(),
  };
});

vi.mock("./runtime-detect.js", () => ({
  isPlaywrightAvailable: vi.fn(() => false),
  readBrowserConfig: vi.fn(() => ({})),
}));

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

async function mockCleanWorktree() {
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
}

async function setCandidates(
  candidates: Array<{ id: string; updatedAt: string; urls: string[]; body?: string }>,
) {
  const { listResearchRetryCandidates } = await import("./candidates.js");
  vi.mocked(listResearchRetryCandidates).mockReturnValue(
    candidates.map((c) => ({
      id: c.id,
      updatedAt: c.updatedAt,
      urls: c.urls,
      body: c.body ?? bodyFromUrls(c.urls),
    })),
  );
}

function bodyFromUrls(urls: string[]): string {
  return ["## Resources", "", ...urls.map((u) => `- ${u}`), ""].join("\n");
}

async function setCapability(opts: {
  playwright?: boolean;
  storageStatePath?: string | null;
}) {
  const { isPlaywrightAvailable, readBrowserConfig } = await import(
    "./runtime-detect.js"
  );
  vi.mocked(isPlaywrightAvailable).mockReturnValue(opts.playwright ?? false);
  vi.mocked(readBrowserConfig).mockReturnValue(
    opts.storageStatePath ? { storageStatePath: opts.storageStatePath } : {},
  );
}

function createTempProfile(): string {
  const dir = mkdtempSync(join(tmpdir(), "research-retry-profile-"));
  const path = join(dir, "storage-state.json");
  writeFileSync(path, "{}");
  return path;
}

describe("research-retry workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips the agent step when there are no blocked research candidates", async () => {
    await mockCleanWorktree();
    await setCandidates([]);
    await setCapability({ playwright: true });

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
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
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("skips the agent step when worktree is dirty", async () => {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: true,
      trackedDirty: true,
      entries: [" M data/tasks/blocked/x.md"],
      fingerprint: " M data/tasks/blocked/x.md",
      summary: "data/tasks/blocked/x.md",
      headSha: "abc1234",
    });
    await setCapability({ playwright: true, storageStatePath: createTempProfile() });
    await setCandidates([
      { id: "task-a", updatedAt: "2026-04-20T00:00:00.000Z", urls: ["https://x.com/foo/status/1"] },
    ]);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
    });

    const result = await harness.run();

    expect(result.steps.retry.status).toBe("skipped");
    expect(result.steps["mark-attempt"].status).toBe("skipped");
  });

  it("skips when capability is absent for every candidate URL", async () => {
    await mockCleanWorktree();
    await setCapability({ playwright: false, storageStatePath: null });
    await setCandidates([
      {
        id: "task-x",
        updatedAt: "2026-04-14T00:29:07.947Z",
        urls: [
          "https://x.com/akshay_pachaar/status/2041146899319971922",
          "https://openai.com/index/why-we-no-longer-evaluate/",
        ],
      },
    ]);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    const output = result.steps["inspect-candidates"].output as {
      candidate: unknown;
      examined: Array<{ id: string; skipReason: { kind: string } }>;
    };
    expect(output.candidate).toBeNull();
    expect(output.examined).toHaveLength(1);
    expect(output.examined[0].id).toBe("task-x");
    expect(output.examined[0].skipReason.kind).toBe("capability-absent");
    expect(result.steps.retry.status).toBe("skipped");
    expect(result.steps["mark-attempt"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("skips when fingerprint marker matches the current URL set", async () => {
    await mockCleanWorktree();
    await setCapability({ playwright: true, storageStatePath: createTempProfile() });
    const urls = [
      "https://x.com/akshay_pachaar/status/2041146899319971922",
      "https://x.com/arlanr/status/2041215978957389908",
    ];
    const { computeResourceFingerprint, renderRetryMarker } = await import(
      "./precondition.js"
    );
    const fingerprint = computeResourceFingerprint(urls);
    const marker = renderRetryMarker({
      fingerprint,
      attemptedAt: "2026-04-22T23:47:08.339Z",
    });
    const body = `${bodyFromUrls(urls)}\n\n${marker}\n`;

    await setCandidates([
      { id: "task-x", updatedAt: "2026-04-22T23:47:08.339Z", urls, body },
    ]);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
    });

    const result = await harness.run();
    const output = result.steps["inspect-candidates"].output as {
      candidate: unknown;
      examined: Array<{ skipReason: { kind: string } }>;
    };
    expect(output.candidate).toBeNull();
    expect(output.examined[0].skipReason.kind).toBe(
      "no-change-since-last-attempt",
    );
    expect(result.steps.retry.status).toBe("skipped");
    expect(result.steps["mark-attempt"].status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("picks the next candidate when the oldest is stale", async () => {
    await mockCleanWorktree();
    await setCapability({ playwright: true, storageStatePath: createTempProfile() });
    const staleUrls = ["https://x.com/foo/status/1"];
    const { computeResourceFingerprint, renderRetryMarker } = await import(
      "./precondition.js"
    );
    const staleMarker = renderRetryMarker({
      fingerprint: computeResourceFingerprint(staleUrls),
      attemptedAt: "2026-04-14T00:00:00.000Z",
    });
    const freshUrls = ["https://example.com/article"];

    await setCandidates([
      {
        id: "task-stale",
        updatedAt: "2026-04-14T00:00:00.000Z",
        urls: staleUrls,
        body: `${bodyFromUrls(staleUrls)}\n\n${staleMarker}\n`,
      },
      {
        id: "task-fresh",
        updatedAt: "2026-04-20T00:00:00.000Z",
        urls: freshUrls,
      },
    ]);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({
      committed: true,
    } as never);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      stepMocks: {
        retry: { turns: [], totalCostUsd: 0.01 },
        "mark-attempt": { written: false, reason: "task moved to done" },
      },
    });

    const result = await harness.run();
    const output = result.steps["inspect-candidates"].output as {
      candidate: { id: string };
      examined: Array<{ id: string }>;
    };
    expect(output.candidate.id).toBe("task-fresh");
    expect(output.examined.map((e) => e.id)).toEqual(["task-stale"]);
    expect(result.steps.retry.status).toBe("success");
    expect(result.steps["mark-attempt"].status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("picks the oldest candidate when capability is met and nothing is stale", async () => {
    await mockCleanWorktree();
    await setCapability({ playwright: true, storageStatePath: createTempProfile() });
    await setCandidates([
      {
        id: "task-old",
        updatedAt: "2026-04-14T00:29:07.947Z",
        urls: ["https://openai.com/index/x/", "https://x.com/a/status/1"],
      },
      {
        id: "task-new",
        updatedAt: "2026-04-20T20:18:43.712Z",
        urls: ["https://example.com/article"],
      },
    ]);
    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      stepMocks: {
        retry: { turns: [], totalCostUsd: 0.01 },
        "mark-attempt": { written: false, reason: "no resource URLs remain" },
      },
    });

    const result = await harness.run();

    expect(result.steps["inspect-candidates"].output).toMatchObject({
      candidate: { id: "task-old" },
      candidateCount: 2,
    });
    expect(result.steps.retry.status).toBe("success");
    expect(result.steps["mark-attempt"].status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("skips all work on runtime.recovered triggers", async () => {
    await mockCleanWorktree();
    await setCapability({ playwright: true, storageStatePath: createTempProfile() });
    await setCandidates([
      { id: "task-a", updatedAt: "2026-04-14T00:00:00.000Z", urls: ["https://example.com/"] },
    ]);
    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "runtime.recovered", payload: {} },
    });

    const result = await harness.run();
    expect(result.steps["inspect-candidates"].status).toBe("skipped");
    expect(result.steps.retry.status).toBe("skipped");
    expect(result.steps["mark-attempt"].status).toBe("skipped");
  });

  it("writeMarkerForCandidate refreshes the marker after the agent edits resources", async () => {
    const { writeMarkerForCandidate, computeResourceFingerprint } = await import(
      "./precondition.js"
    );
    const projectDir = mkdtempSync(join(tmpdir(), "research-retry-mark-"));
    const blockedDir = join(projectDir, "data", "tasks", "blocked");
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
        "id: task-x",
        "updated_at: 2026-04-22T00:00:00.000Z",
        "---",
        "## Problem",
        "Body",
        "",
        "## Resources",
        ...initialUrls.map((u) => `- ${u}`),
        "",
      ].join("\n"),
    );

    const result = writeMarkerForCandidate({
      projectDir,
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
    const projectDir = mkdtempSync(join(tmpdir(), "research-retry-mark-"));
    const doneDir = join(projectDir, "data", "tasks", "done");
    mkdirSync(doneDir, { recursive: true });
    const taskFile = join(doneDir, "task-y.md");
    writeFileSync(
      taskFile,
      [
        "---",
        "id: task-y",
        "updated_at: 2026-04-22T00:00:00.000Z",
        "---",
        "## Problem",
        "Body",
        "",
        "## Resources",
        "- https://example.com/x",
        "",
      ].join("\n"),
    );

    const result = writeMarkerForCandidate({
      projectDir,
      candidateId: "task-y",
    });

    expect(result.written).toBe(false);
    if (result.written) throw new Error("unexpected write");
    expect(result.reason).toBe("task moved to done");
  });
});
