import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import { WRITER_INTEGRATION_EVIDENCE } from "#core/workflow/writer-integration-evidence.js";
import {
  collectSecurityReviewGitEvidence,
  type InspectSecurityReviewDueOptions,
  inspectSecurityReviewDue,
} from "./due-check.js";

describe("security-review due check", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-security-review-due-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(workspaceRoot, { recursive: true });
    execFileSync("git", ["init"], { cwd: workspaceRoot, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(workspaceRoot, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  });

  function git(args: readonly string[]): string {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  function writeProjectFile(path: string, content: string): void {
    const fullPath = join(workspaceRoot, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  function commitAll(message: string): string {
    git(["add", "."]);
    git([
      "-c",
      "user.email=kota@example.test",
      "-c",
      "user.name=KOTA Test",
      "commit",
      "--no-gpg-sign",
      "-m",
      message,
    ]);
    return git(["rev-parse", "HEAD"]);
  }

  function writeReviewEvidence(args: {
    runId: string;
    completedAt: string;
    commitSha: string;
  }): void {
    const runDir = join(workspaceRoot, ".kota", "runs", args.runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      `${JSON.stringify(
        {
          metadataVersion: 1,
          id: args.runId,
          workflow: "security-review",
          definitionPath: "src/modules/autonomy/workflows/security-review/workflow.ts",
          trigger: { event: "manual", schemaRef: null, payload: {} },
          startedAt: args.completedAt,
          status: "success",
          completedAt: args.completedAt,
          runDir: `.kota/runs/${args.runId}`,
          steps: [],
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    writeFileSync(
      join(runDir, WRITER_INTEGRATION_EVIDENCE),
      `${JSON.stringify(
        {
          version: 1,
          runId: args.runId,
          workflow: "security-review",
          scopeId: "security-review-test",
          targetBranch: "main",
          baseHead: args.commitSha,
          integratedFromHead: args.commitSha,
          publishedHead: args.commitSha,
          commitSubject: "security review",
          commitMessage: "security review",
          changedPaths: [],
          completedAt: args.completedAt,
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
    writeFileSync(
      join(runDir, "security-review-outcome.json"),
      `${JSON.stringify({ outcome: "no-op", reason: "test-review" }, null, 2)}\n`,
      "utf-8",
    );
  }

  function writeOpenSecurityTask(): void {
    const dir = join(workspaceRoot, "data", "tasks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-security-review-open-finding.md"),
      [
        "---",
        "status: open",
        "priority: p1",
        "---",
        "",
        "# Security review: open finding",
        "",
        "## Source / Intent",
        "",
        "Created by security-review workflow run prior-review.",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  async function inspectDue(
    options: InspectSecurityReviewDueOptions,
  ) {
    const gitEvidence = await collectSecurityReviewGitEvidence({
      workspaceRoot,
      scopeRoot: workspaceRoot,
      stateDir: options.stateDir,
      runCommand: createWorkflowCommandRunner({ cwd: workspaceRoot }),
    });
    return inspectSecurityReviewDue(workspaceRoot, options, gitEvidence);
  }

  it("reports due when security-sensitive source changes after the last review", async () => {
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-base",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeProjectFile("src/modules/secrets/index.ts", "const apiKey = process.env.SECRET_TOKEN;\n");
    commitAll("touch secrets");

    const decision = await inspectDue({
      now: new Date("2026-05-25T00:00:00.000Z"),
      stateDir: join(workspaceRoot, ".kota"),
    });

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe("high-risk-security-sensitive-change");
    expect(decision.changedSurfaces).toEqual([
      {
        surface: "secret-handling",
        paths: ["src/modules/secrets/index.ts"],
      },
    ]);
    expect(decision.lastReview).toMatchObject({
      kind: "found",
      runId: "2026-05-24T00-00-00-000Z-security-review-base",
    });
  });

  it("reports due for scanner-matched security-sensitive changes outside preferred prefixes", async () => {
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-base",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeProjectFile(
      "src/core/modules/registry-installers.ts",
      [
        "import { spawnSync } from 'node:child_process';",
        "export async function install(url: string): Promise<void> {",
        "  spawnSync('installer', [url]);",
        "  await fetch(url);",
        "}",
        "",
      ].join("\n"),
    );
    commitAll("touch registry installer execution");

    const decision = await inspectDue({
      now: new Date("2026-05-25T00:00:00.000Z"),
      stateDir: join(workspaceRoot, ".kota"),
    });

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe("high-risk-security-sensitive-change");
    expect(decision.changedSurfaces).toEqual([
      {
        surface: "external-fetch",
        paths: ["src/core/modules/registry-installers.ts"],
      },
      {
        surface: "tool-execution",
        paths: ["src/core/modules/registry-installers.ts"],
      },
    ]);
    expect(decision.highRiskChangedPaths).toEqual([
      "src/core/modules/registry-installers.ts",
    ]);
  });

  it("reports not due when the current head has already been reviewed", async () => {
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url);\n");
    const reviewedSha = commitAll("reviewed security surface");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-reviewed",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });

    const decision = await inspectDue({
      now: new Date("2026-05-25T00:00:00.000Z"),
      stateDir: join(workspaceRoot, ".kota"),
    });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("no-security-sensitive-change");
    expect(decision.changedSurfaces).toEqual([]);
  });

  it("defers routine review when open security follow-up tasks already exist", async () => {
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-pressure",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeOpenSecurityTask();
    writeProjectFile(
      "src/modules/autonomy/workflows/security-review/prompt.md",
      "Review the changed workflow prompt.\n",
    );
    commitAll("touch security review prompt");

    const decision = await inspectDue({
      now: new Date("2026-05-25T00:00:00.000Z"),
      stateDir: join(workspaceRoot, ".kota"),
    });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("open-security-task-pressure");
    expect(decision.openSecurityTasks.map((task) => task.id)).toEqual([
      "task-security-review-open-finding",
    ]);
    expect(decision.highRiskChangedPaths).toEqual([]);
  });

  it("does not repeat after review evidence records the changed head", async () => {
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-before",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeProjectFile("src/core/mcp/client.ts", "const transport = new McpClient();\n");
    const changedSha = commitAll("touch mcp transport");

    const dueDecision = await inspectDue({
      now: new Date("2026-05-25T00:00:00.000Z"),
      stateDir: join(workspaceRoot, ".kota"),
    });

    expect(dueDecision.due).toBe(true);
    expect(dueDecision.changedSurfaces.map((entry) => entry.surface)).toEqual([
      "mcp-transport",
    ]);

    writeReviewEvidence({
      runId: "2026-05-25T00-10-00-000Z-security-review-after",
      completedAt: "2026-05-25T00:10:00.000Z",
      commitSha: changedSha,
    });

    const afterReview = await inspectDue({
      now: new Date("2026-05-25T01:20:00.000Z"),
      stateDir: join(workspaceRoot, ".kota"),
    });

    expect(afterReview.due).toBe(false);
    expect(afterReview.reason).toBe("no-security-sensitive-change");
    expect(afterReview.changedSurfaces).toEqual([]);
  });
});
