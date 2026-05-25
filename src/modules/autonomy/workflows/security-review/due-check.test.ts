import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inspectSecurityReviewDue } from "./due-check.js";

describe("security-review due check", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-security-review-due-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function git(args: readonly string[]): string {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  }

  function writeProjectFile(path: string, content: string): void {
    const fullPath = join(projectDir, path);
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
    const runDir = join(projectDir, ".kota", "runs", args.runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "metadata.json"),
      `${JSON.stringify(
        {
          id: args.runId,
          workflow: "security-review",
          status: "success",
          completedAt: args.completedAt,
          steps: [
            {
              id: "commit",
              output: {
                sha: args.commitSha,
              },
            },
          ],
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
    const dir = join(projectDir, "data", "tasks", "ready");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "task-security-review-open-finding.md"),
      [
        "---",
        "id: task-security-review-open-finding",
        "title: Security review: open finding",
        "status: ready",
        "priority: p1",
        "area: security",
        "summary: open finding",
        "created_at: 2026-05-24T00:00:00.000Z",
        "updated_at: 2026-05-24T00:00:00.000Z",
        "---",
        "",
        "## Source / Intent",
        "",
        "Created by security-review workflow run prior-review.",
        "",
      ].join("\n"),
      "utf-8",
    );
  }

  it("reports due when security-sensitive source changes after the last review", () => {
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-base",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeProjectFile("src/modules/secrets/index.ts", "const apiKey = process.env.SECRET_TOKEN;\n");
    commitAll("touch secrets");

    const decision = inspectSecurityReviewDue(projectDir, {
      now: new Date("2026-05-25T00:00:00.000Z"),
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

  it("reports due for scanner-matched security-sensitive changes outside preferred prefixes", () => {
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

    const decision = inspectSecurityReviewDue(projectDir, {
      now: new Date("2026-05-25T00:00:00.000Z"),
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

  it("reports not due when the current head has already been reviewed", () => {
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url);\n");
    const reviewedSha = commitAll("reviewed security surface");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-reviewed",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });

    const decision = inspectSecurityReviewDue(projectDir, {
      now: new Date("2026-05-25T00:00:00.000Z"),
    });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("no-security-sensitive-change");
    expect(decision.changedSurfaces).toEqual([]);
  });

  it("defers routine review when open security follow-up tasks already exist", () => {
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

    const decision = inspectSecurityReviewDue(projectDir, {
      now: new Date("2026-05-25T00:00:00.000Z"),
    });

    expect(decision.due).toBe(false);
    expect(decision.reason).toBe("open-security-task-pressure");
    expect(decision.openSecurityTasks.map((task) => task.id)).toEqual([
      "task-security-review-open-finding",
    ]);
    expect(decision.highRiskChangedPaths).toEqual([]);
  });

  it("does not repeat after review evidence records the changed head", () => {
    writeProjectFile("README.md", "initial\n");
    const reviewedSha = commitAll("initial");
    writeReviewEvidence({
      runId: "2026-05-24T00-00-00-000Z-security-review-before",
      completedAt: "2026-05-24T00:00:00.000Z",
      commitSha: reviewedSha,
    });
    writeProjectFile("src/core/mcp/client.ts", "const transport = new McpClient();\n");
    const changedSha = commitAll("touch mcp transport");

    const dueDecision = inspectSecurityReviewDue(projectDir, {
      now: new Date("2026-05-25T00:00:00.000Z"),
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

    const afterReview = inspectSecurityReviewDue(projectDir, {
      now: new Date("2026-05-25T01:20:00.000Z"),
    });

    expect(afterReview.due).toBe(false);
    expect(afterReview.reason).toBe("no-security-sensitive-change");
    expect(afterReview.changedSurfaces).toEqual([]);
  });
});
