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
import { networkDestructiveEffect, networkReadEffect } from "#core/tools/effect.js";
import { registerTool } from "#core/tools/tool-registry.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowScenarioDriver } from "#core/workflow/testing/index.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { xPostReadTool } from "#modules/browser/x-post-read.js";
import { webFetchTool } from "#modules/web-access/web-fetch.js";
import { scopePolicySnapshotForTest } from "../scope-improver/scope-policy-test-support.js";
import { inspectResearchRetryCandidatesInWorker } from "./blocking-operations.js";
import { extractResourceUrls, listResearchRetryCandidates } from "./candidates.js";
import {
  availableResearchSourceTools,
  checkResearchRetryCapability,
  computeResourceFingerprint,
  evaluateCandidate,
  type ResearchRetryCapability,
  type ResearchSourceAttempt,
  readRetryMarker,
  renderRetryMarker,
  SOURCE_RETRY_INTERVAL_MS,
  sourceAccessFingerprint,
} from "./precondition.js";
import { collectResearchSourceEvidence } from "./source-evidence.js";
import { assertResearchRetryTrigger } from "./trigger.js";
import researchRetryWorkflow from "./workflow.js";

function bodyFromUrls(urls: string[]): string {
  return ["## Blocked on", "kind: operator-capture", "path: evidence", "description: Read the pending sources", "", ...urls.map((u) => `- [Source](${u})`), ""].join("\n");
}

const capability: ResearchRetryCapability = {
  availableTools: ["web_fetch", "rendered_article_read", "x_post_read"],
  playwrightAvailable: false, authProfileConfigured: false, authProfileExists: false, authProfileRevision: null,
};
function attempt(url: string, access = capability, attemptedAt = new Date().toISOString()): ResearchSourceAttempt {
  return { url, attemptedAt, accessFingerprint: sourceAccessFingerprint(url, access), tools: ["web_fetch"], outcome: "unavailable" };
}

const roots: string[] = [];
const cleanups: Array<() => void> = [];

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
  for (const cleanup of cleanups.splice(0)) cleanup();
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

  it("rejects unsupported triggers and malformed availability before candidate inspection", () => {
    const valid = researchRetryTrigger();
    expect(() => assertResearchRetryTrigger(valid)).not.toThrow();
    expect(() => assertResearchRetryTrigger({ ...valid, event: "runtime.idle" }))
      .toThrow("accepts only");
    for (const payload of [
      {},
      { ...valid.payload, attemptableCount: 0 },
      { ...valid.payload, attemptableCount: 2 },
      { ...valid.payload, counts: { open: 0, blocked: -1, done: 0, dropped: 0 } },
    ]) {
      expect(() => assertResearchRetryTrigger({ ...valid, payload }))
        .toThrow("payload must match");
    }
  });

  it("skips the agent step when there are no blocked research candidates", async () => {
    const workspaceRoot = createResearchProject();

    const harness = new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: researchRetryTrigger(),
      workspaceRoot,
    });

    const result = await harness.run();

    expect(result.status, result.error).toBe("success");
    expect(result.steps["inspect-candidates"].output).toMatchObject({
      candidate: null,
      candidateCount: 0,
      examined: [],
    });
    expect(result.steps.retry.status).toBe("skipped");
  });

  it("skips the agent step when worktree is dirty", async () => {
    const workspaceRoot = createResearchProject([
      {
        id: "task-a",
        urls: ["https://example.com/article"],
      },
    ]);

    const harness = new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: researchRetryTrigger(),
      workspaceRoot,
      setupWorkspace: (workspaceDir) => {
        writeFileSync(join(workspaceDir, "dirty.txt"), "uncommitted\n");
      },
    });

    const result = await harness.run();

    expect(result.steps.retry.status).toBe("skipped");
  });

  it("classifies candidates as unavailable when every URL lacks its capability", () => {
    const urls = [
      "https://x.com/akshay_pachaar/status/2041146899319971922",
      "https://openai.com/index/why-we-no-longer-evaluate/",
    ];
    expect(evaluateCandidate({
      urls,
      body: bodyFromUrls(urls),
      capability,
    }).skipReason).toEqual({
      kind: "capability-absent",
      classes: ["x-post", "js-rendered"],
    });
  });

  it("dedupes actual sources until access changes or the bounded retry interval expires", () => {
    const urls = [
      "https://example.com/research-a",
      "https://example.com/research-b",
    ];
    const fingerprint = computeResourceFingerprint(urls);
    const marker = renderRetryMarker({
      fingerprint,
      attemptedAt: "2026-04-22T23:47:08.339Z",
      attempts: urls.map((url) => attempt(url, capability, "2026-04-22T23:47:08.339Z")),
    });
    const input = {
      urls,
      body: `${bodyFromUrls(urls)}\n${marker}\n`,
      capability,
      now: Date.parse("2026-04-22T23:47:08.339Z") + 60_000,
    };
    expect(evaluateCandidate(input).skipReason).toEqual({ kind: "no-change-since-last-attempt", fingerprint });
    expect(evaluateCandidate({ ...input, now: input.now + SOURCE_RETRY_INTERVAL_MS }).attemptableUrls).toEqual(urls);
    expect(evaluateCandidate({ ...input, capability: { ...capability, playwrightAvailable: true, authProfileExists: true, authProfileConfigured: true, authProfileRevision: "restored" } }).attemptableUrls).toEqual(urls);
    expect(evaluateCandidate({ ...input, capability: { ...capability, authProfileExists: true, authProfileConfigured: true, authProfileRevision: "restored" } }).attemptableUrls).toEqual([]);
    expect(evaluateCandidate({ ...input, urls: [...urls, "https://example.com/new"] }).attemptableUrls).toEqual(["https://example.com/new"]);
    expect(evaluateCandidate({ ...input, body: `<!-- research-retry-attempt: fingerprint=${fingerprint} attempted_at=2026-04-22T23:47:08.339Z -->` }).attemptableUrls).toEqual(urls);
    const browser = { ...capability, playwrightAvailable: true, authProfileConfigured: true, authProfileExists: true, authProfileRevision: "expired" };
    const xUrl = "https://x.com/a/status/1";
    const xBody = renderRetryMarker({ fingerprint: computeResourceFingerprint([xUrl]), attemptedAt: "2026-04-22T23:47:08.339Z", attempts: [{ ...attempt(xUrl, browser, "2026-04-22T23:47:08.339Z"), tools: ["x_post_read"] }] });
    expect(evaluateCandidate({ urls: [xUrl], body: xBody, capability: browser, now: input.now }).attemptableUrls).toEqual([]);
    expect(evaluateCandidate({ urls: [xUrl], body: xBody, capability: { ...browser, authProfileRevision: "restored" }, now: input.now }).attemptableUrls).toEqual([xUrl]);
  });

  it("picks the next candidate when the oldest URL set was already attempted", () => {
    const staleUrls = ["https://example.com/stale"];
    const freshUrls = ["https://example.com/article"];
    const workspaceRoot = createResearchProject([
      {
        id: "task-a-stale",
        urls: staleUrls,
      },
      {
        id: "task-z-fresh",
        urls: freshUrls,
      },
    ]);
    const path = join(workspaceRoot, "data/tasks/task-a-stale.md");
    writeFileSync(path, readFileSync(path, "utf8") + renderRetryMarker({
      fingerprint: computeResourceFingerprint(staleUrls),
      attemptedAt: new Date().toISOString(),
      attempts: staleUrls.map((url) => attempt(url, checkResearchRetryCapability(workspaceRoot, capability.availableTools))),
    }));
    const output = inspectResearchRetryCandidatesInWorker({ workspaceRoot, availableTools: capability.availableTools });
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
    cleanups.push(registerTool(webFetchTool, async (input) => {
      expect(input.url).toBe("https://example.com/article");
      return { content: "Screened source body", is_error: false };
    }, "web-access", { effect: networkReadEffect() }));
    const prompts = new Map<string, string>();
    const harness = new WorkflowScenarioDriver(researchRetryWorkflow, {
      trigger: researchRetryTrigger(),
      workspaceRoot,
      scopePolicySnapshot: scopePolicySnapshotForTest(workspaceRoot),
      ports: {
        runCommand: successfulWorkflowCommandRun,
        runTool: "registered",
        runAgent: async ({ stepId, prompt }) => {
          prompts.set(stepId, prompt);
          return stepId === "retry" ? { content: "Research attempt completed." } : {
            decision: "pass",
            summary: "The source decision matches the task state.",
            citedArtifacts: ["metadata:collect-sources"],
            findings: [],
          };
        },
      },
    });

    const result = await harness.run();
    expect(result.steps["inspect-candidates"].output).toMatchObject({
      candidate: { id: "task-new" },
      candidateCount: 2,
    });
    expect(result.status, result.error).toBe("success");
    expect(result.steps.retry.status).toBe("success");
    expect(result.steps["collect-sources"].output).toMatchObject({
      attempts: [{ url: "https://example.com/article", tools: ["web_fetch"], outcome: "readable" }],
      sources: [{ readings: [{ content: "Screened source body" }] }],
    });
    expect(result.steps["mark-attempt"].output).toMatchObject({ written: true });
    expect(prompts.get("retry")).toContain("Screened source body");
    const shadow = result.steps["shadow-semantic-review"].output as { artifactPath: string };
    expect(JSON.parse(readFileSync(shadow.artifactPath, "utf8")).target.artifactPaths).toEqual(expect.arrayContaining([
      "metadata:inspect-candidates", "metadata:collect-sources", "metadata:mark-attempt",
    ]));
  });

  it("writeMarkerForCandidate records only actual attempts after the agent edits sources", async () => {
    const { writeMarkerForCandidate, computeResourceFingerprint } = await import(
      "./precondition.js"
    );
    const workspaceRoot = mkdtempSync(join(tmpdir(), "research-retry-mark-"));
    roots.push(workspaceRoot);
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
      attempts: [attempt(initialUrls[0]!, capability, "2026-04-23T00:00:00.000Z")],
    });

    expect(result.written).toBe(true);
    if (!result.written) throw new Error("expected written");
    expect(result.fingerprint).toBe(computeResourceFingerprint(initialUrls));
    const updated = readFileSync(taskFile, "utf8");
    expect(readRetryMarker(updated)?.attempts).toEqual([attempt(initialUrls[0]!, capability, "2026-04-23T00:00:00.000Z")]);
    expect(extractResourceUrls(updated)).toEqual(initialUrls);
  });

  it("writeMarkerForCandidate is a no-op when the task moved out of blocked", async () => {
    const { writeMarkerForCandidate } = await import("./precondition.js");
    const workspaceRoot = mkdtempSync(join(tmpdir(), "research-retry-mark-"));
    roots.push(workspaceRoot);
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
      attempts: [attempt("https://example.com/x")],
    });

    expect(result.written).toBe(false);
    if (result.written) throw new Error("unexpected write");
    expect(result.reason).toBe("task moved to done");
  });

  it("finds normal pending Markdown URLs without turning owner decisions into research", () => {
    const body = `Already read https://example.com/old\n\n${bodyFromUrls(["https://example.com/a_(b)", "https://twitter.com/a/status/1"])}`;
    expect(extractResourceUrls(body)).toEqual(["https://example.com/a_(b)", "https://twitter.com/a/status/1"]);
    const task = { id: "task-research", state: "blocked" as const, title: "Research", priority: "p2" as const, dependsOn: [], body };
    expect(listResearchRetryCandidates("unused", [task])).toHaveLength(1);
    expect(listResearchRetryCandidates("unused", [{ ...task, body: "## Blocked on\nkind: owner-decision\nslot: approval\nquestion: Implement https://example.com/new?" }])).toEqual([]);
    expect(extractResourceUrls("See <https://example.com/auto> and [ref][1].\n[1]: https://example.com/reference")).toEqual(["https://example.com/auto", "https://example.com/reference"]);
  });

  it("requires legal writer tool access, not just a configured browser", () => {
    const root = createResearchProject();
    const policy = scopePolicySnapshotForTest(root).policy;
    cleanups.push(registerTool(webFetchTool, vi.fn(), "web-access", { effect: networkReadEffect() }));
    cleanups.push(registerTool(xPostReadTool, vi.fn(), "browser", { effect: networkDestructiveEffect() }));
    expect(availableResearchSourceTools(policy)).toEqual(["web_fetch"]);
    expect(availableResearchSourceTools(undefined)).toEqual([]);
    const xUrl = "https://x.com/a/status/1";
    expect(evaluateCandidate({ urls: [xUrl], body: bodyFromUrls([xUrl]), capability: {
      ...capability, playwrightAvailable: true, authProfileExists: true,
      availableTools: availableResearchSourceTools(policy),
    } }).attemptableUrls).toEqual([]);
    const denied = scopePolicySnapshotForTest(root, [{ scopeId: policy.scopeId,
      reason: "Disable network reads", externalEffects: { networkRead: "deny" },
    }]);
    expect(availableResearchSourceTools(denied.policy)).toEqual([]);
  });

  it("collects through the supplied tool boundary and propagates policy failures", async () => {
    const runTool = vi.fn().mockResolvedValueOnce({ content: "Auth wall", is_error: true })
      .mockResolvedValueOnce({ content: "Rendered article" })
      .mockResolvedValueOnce({ content: "Requires JavaScript", is_error: true })
      .mockResolvedValueOnce({ content: "Rendered fallback" });
    const evidence = await collectResearchSourceEvidence({
      urls: ["https://twitter.com/a/status/1", "https://openai.com/index/article/", "https://example.com/js"],
      capability: { ...capability, playwrightAvailable: true }, runTool,
    });
    expect(runTool.mock.calls.map(([name]) => name)).toEqual(["x_post_read", "rendered_article_read", "web_fetch", "rendered_article_read"]);
    expect(evidence.attempts.map(({ outcome, tools }) => ({ outcome, tools }))).toEqual([
      { outcome: "unavailable", tools: ["x_post_read"] },
      { outcome: "readable", tools: ["rendered_article_read"] },
      { outcome: "readable", tools: ["web_fetch", "rendered_article_read"] },
    ]);
    const last = evidence.attempts[2]!;
    const body = renderRetryMarker({ fingerprint: computeResourceFingerprint([last.url]), attemptedAt: last.attemptedAt, attempts: [last] });
    expect(evaluateCandidate({ urls: [last.url], body, capability: { ...capability, playwrightAvailable: true } }).attemptableUrls).toEqual([]);
    expect(evaluateCandidate({ urls: [last.url], body, capability: { ...capability, playwrightAvailable: true, authProfileRevision: "restored" } }).attemptableUrls).toEqual([last.url]);
    await expect(collectResearchSourceEvidence({ urls: ["https://example.com/no"], capability, runTool: async () => { throw new Error("policy denied"); } })).rejects.toThrow("policy denied");
  });
});
