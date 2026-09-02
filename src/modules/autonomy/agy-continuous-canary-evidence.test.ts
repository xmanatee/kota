import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import type { WriterIntegrationEvidence } from "#core/workflow/writer-integration-evidence.js";
import {
  collectAgyCanaryRunEvidence,
  materializeAgyCanaryFindingTask,
} from "./agy-continuous-canary-evidence.js";

const roots: string[] = [];

function git(root: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `/opt/homebrew/bin:${process.env.PATH ?? ""}`,
      TMPDIR: root,
    },
  }).trim();
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("AGY canary quality evidence", () => {
  it("makes a deduplicated minor-finding task actionable", async () => {
    const updateBody = vi.fn(async () => ({
      ok: true as const,
      id: "task-investigate-agy-canary-finding-review-timeout",
      state: "open" as const,
      content: "updated",
    }));
    const ctx = {
      client: {
        tasks: {
          create: async () => ({
            ok: false as const,
            reason: "already_exists" as const,
          }),
          show: async () => ({
            found: true as const,
            state: "open" as const,
            content: "thin existing task",
          }),
          updateBody,
        },
      },
    } as unknown as ModuleContext;

    await materializeAgyCanaryFindingTask(ctx, {
      fingerprint: "review-timeout",
      title: "Review latency was elevated",
      description: "The review exceeded its expected latency during the canary window.",
      evidenceRef: "artifact:.kota/runs/canary/evidence.json",
    });

    expect(updateBody).toHaveBeenCalledWith(
      "task-investigate-agy-canary-finding-review-timeout",
      expect.stringContaining("The review exceeded its expected latency"),
    );
    expect(updateBody).toHaveBeenCalledWith(
      "task-investigate-agy-canary-finding-review-timeout",
      expect.stringContaining("artifact:.kota/runs/canary/evidence.json"),
    );
  });

  it("materializes the task, applicable instructions, step input, and published diff", () => {
    const root = mkdtempSync(join(tmpdir(), "kota-agy-canary-evidence-"));
    roots.push(root);
    git(root, ["init", "--quiet"]);
    git(root, ["config", "user.email", "canary@example.test"]);
    git(root, ["config", "user.name", "Canary Test"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    mkdirSync(join(root, "data", "tasks"), { recursive: true });
    writeFileSync(join(root, "AGENTS.md"), "Inspect the example before editing.\n");
    writeFileSync(join(root, "agent.md"), "Implement the assigned task carefully.\n");
    writeFileSync(
      join(root, "data", "tasks", "task-canary.md"),
      "---\nstatus: open\npriority: p1\n---\n\n# Canary task\n\nUse examples/example.ts.\n",
    );
    writeFileSync(join(root, "product.txt"), "before\n");
    git(root, ["add", "AGENTS.md", "agent.md", "data/tasks/task-canary.md", "product.txt"]);
    git(root, ["commit", "--quiet", "-m", "baseline"]);
    const baseHead = git(root, ["rev-parse", "HEAD"]);
    writeFileSync(join(root, "product.txt"), "after\n");
    git(root, ["add", "product.txt"]);
    git(root, ["commit", "--quiet", "-m", "publish canary run"]);
    const publishedHead = git(root, ["rev-parse", "HEAD"]);

    const runId = "run-canary";
    const runDir = join(root, ".kota", "runs", runId);
    const outputDir = join(root, ".kota", "runs", "canary", "window");
    mkdirSync(join(runDir, "steps"), { recursive: true });
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify({ id: runId }));
    writeFileSync(
      join(runDir, "steps", "build.input.md"),
      "# User Prompt\n\nCanonical redacted provider input.\n",
    );
    writeFileSync(
      join(runDir, "steps", "review.agent-attempts.jsonl"),
      `${JSON.stringify({
        harness: "antigravity-cli",
        model: "gemini-2.5-pro",
        prompt: "Review the produced change against its instructions.",
        systemPrompt: "Act as an independent reviewer.",
        outcome: "success",
      })}\n`,
    );
    const run: WorkflowRunDetail = {
      id: runId,
      workflow: "builder",
      status: "success",
      triggerEvent: "autonomy.queue.available",
      triggerSchemaRef: null,
      startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T01:00:00.000Z",
      triggerPayload: {
        taskId: "task-canary",
        taskPath: "data/tasks/task-canary.md",
      },
      steps: [{
        id: "build",
        type: "agent",
        status: "success",
        durationMs: 1,
      }, {
        id: "review",
        type: "code",
        status: "success",
        durationMs: 1,
      }],
    };
    const definition = {
      name: "builder",
      repository: "write",
      moduleRoot: root,
      steps: [{
        id: "build",
        type: "agent",
        agentName: "builder",
        moduleRoot: root,
        promptPath: "agent.md",
      }, {
        id: "review",
        type: "code",
        resolveAgentContract: () => ({
          harness: "antigravity-cli",
          model: "gemini-2.5-pro",
          effort: "high",
          autonomyMode: "autonomous",
        }),
        run: () => "reviewed",
      }],
    } as unknown as WorkflowDefinition;
    const integration: WriterIntegrationEvidence = {
      version: 1,
      runId,
      workflow: "builder",
      scopeId: "scope-1",
      targetBranch: "main",
      baseHead,
      integratedFromHead: baseHead,
      publishedHead,
      commitSubject: "publish canary run",
      commitMessage: "publish canary run",
      changedPaths: ["product.txt"],
      completedAt: "2026-09-01T01:00:00.000Z",
    };
    const ctx = {
      cwd: root,
      config: {},
      resolveAgentDef: () => ({
        name: "builder",
        role: "Build",
        promptPath: "agent.md",
        skills: ["examples"],
        writeScope: [],
      }),
      resolveSkillsPrompt: () => "Use examples/example.ts as the reference.",
    } as unknown as ModuleContext;

    const collected = collectAgyCanaryRunEvidence({
      ctx,
      run,
      definition,
      integration,
      runsDir: join(root, ".kota", "runs"),
      outputDir,
      currentTaskContent: null,
      evidenceRef: (path) => `artifact:${relative(root, path)}`,
    });

    expect(collected.diffScopeRef).toBe(
      "artifact:.kota/runs/canary/window/run-canary.published.patch",
    );
    expect(readFileSync(
      join(outputDir, "run-canary.published.patch"),
      "utf8",
    )).toContain("-before\n+after");
    const context = JSON.parse(
      readFileSync(join(outputDir, "run-canary.quality-context.json"), "utf8"),
    ) as {
      task: { content: string; source: string };
      steps: Array<{
        canonicalInputRef?: string;
        agentAttemptEvidenceRef?: string;
        systemPrompt?: string;
      }>;
      writerDiff: { patchRef: string };
    };
    expect(context.task.content).toContain("Use examples/example.ts");
    expect(context.task.source).toBe(
      `git:${baseHead}:data/tasks/task-canary.md`,
    );
    expect(context.steps[0]?.canonicalInputRef).toBe(
      "artifact:.kota/runs/run-canary/steps/build.input.md",
    );
    expect(context.steps[0]?.systemPrompt).toContain(
      "Inspect the example before editing.",
    );
    expect(context.steps[0]?.systemPrompt).toContain(
      "Use examples/example.ts as the reference.",
    );
    expect(context.steps[1]?.agentAttemptEvidenceRef).toBe(
      "artifact:.kota/runs/run-canary/steps/review.agent-attempts.jsonl",
    );
    expect(collected.refs).toContain(
      "artifact:.kota/runs/run-canary/steps/review.agent-attempts.jsonl",
    );
    expect(context.writerDiff.patchRef).toBe(collected.diffScopeRef);
  });
});
