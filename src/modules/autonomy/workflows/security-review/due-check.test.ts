import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGitEvidenceCommand } from "../git-evidence-test-support.js";
import { scanSecurityReviewCandidatesInWorker } from "./blocking-operations.js";
import {
  collectSecurityReviewGitEvidence,
  type InspectSecurityReviewDueOptions,
  inspectSecurityReviewDue,
  reconcileSecurityReviewObservation,
} from "./due-check.js";
import { decodeSecurityReviewState, type SecurityReviewState } from "./review-state.js";
import { scanSecurityReviewCandidates } from "./security-review-candidate-selection.js";
import { securityReviewSurfacesForChangedPath } from "./security-review-file-scan.js";

describe("security-review due check", () => {
  let workspaceRoot: string;
  let reviewState: SecurityReviewState;

  beforeEach(() => {
    reviewState = decodeSecurityReviewState(null);
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
    const entries = git(["ls-tree", "-r", args.commitSha]).split("\n");
    reviewState = { ...reviewState, lastReview: { runId: args.runId, head: args.commitSha, completedAt: args.completedAt },
      reviewed: Object.fromEntries(entries.flatMap((entry) => {
        const [meta, path] = entry.split("\t");
        const surfaces = securityReviewSurfacesForChangedPath(workspaceRoot, path!);
        return surfaces.length ? [[path!, { digest: meta!.split(" ")[2]!, surfaces }]] : [];
      })),
    };
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
      runCommand: runGitEvidenceCommand,
      reviewState,
    });
    return inspectSecurityReviewDue(workspaceRoot, options, gitEvidence);
  }

  it("does not readmit routine review for task publication or archival, but retains explicit reports", async () => {
    const source = "src/modules/example.ts";
    writeProjectFile(source, "writeFileSync(taskPath, body);\n");
    const reviewedSha = commitAll("reviewed source");
    writeReviewEvidence({ runId: "reviewed-source", completedAt: "2026-09-15T00:00:00.000Z", commitSha: reviewedSha });
    const paths = ["data/tasks/task-security-review-repair.md", "data/tasks/archive/task-security-review-done.md"];
    for (const path of paths) {
      const state = path.includes("/archive/") ? "status: done" : "status: open\npriority: p1";
      writeProjectFile(path, `---\n${state}\n---\n# Security review\n\nConfirmed writeFileSync bypass; preserve permission checks.\n`);
      reviewState.unreviewedSurfaces[path] = ["task-workflow-mutation"];
    }
    commitAll("publish security task records");

    expect(await inspectDue({ stateDir: join(workspaceRoot, ".kota"), cooldownMs: 0 })).toMatchObject({
      due: false, reason: "no-security-sensitive-change",
    });
    const gitEvidence = await collectSecurityReviewGitEvidence({ workspaceRoot, scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"), runCommand: runGitEvidenceCommand, reviewState });
    expect(reconcileSecurityReviewObservation({ observedState: reviewState, currentState: reviewState,
      git: gitEvidence, stateDir: join(workspaceRoot, ".kota"),
      inspection: inspectSecurityReviewDue(workspaceRoot, { stateDir: join(workspaceRoot, ".kota"), cooldownMs: 0 }, gitEvidence),
    }).due).toMatchObject({ due: false, reason: "no-security-sensitive-change" });
    expect(scanSecurityReviewCandidates(workspaceRoot, { paths, previousSurfaces: reviewState.unreviewedSurfaces }).candidates).toEqual([]);
    expect(scanSecurityReviewCandidates(workspaceRoot, { paths, evidencePaths: [paths[0]!] }).candidates).toMatchObject([
      { path: paths[0], surface: "reported-boundary" },
    ]);
    // Previously reported boundaries still track changes, even when they are task files.
    expect(securityReviewSurfacesForChangedPath(workspaceRoot, paths[0]!, ["reported-boundary"])).toEqual(["reported-boundary"]);
    writeProjectFile(source, "writeFileSync(otherTaskPath, body);\n");
    commitAll("change actual mutation owner");
    expect(await inspectDue({ stateDir: join(workspaceRoot, ".kota"), cooldownMs: 0 })).toMatchObject({ due: true });
  });

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

  it.each(["replace", "delete"])("keeps a known authorization boundary eligible after %s removes the scanner signal", async (change) => {
    const path = "src/service/gate.ts";
    writeProjectFile(path, "export const mayRead = (user) => user.permission === 'read';\n");
    const reviewedSha = commitAll("authorization gate");
    writeReviewEvidence({ runId: "reviewed-gate", completedAt: "2026-05-24T00:00:00.000Z", commitSha: reviewedSha });
    if (change === "replace") writeProjectFile(path, "export const mayRead = () => true;\n");
    else rmSync(join(workspaceRoot, path));
    commitAll("remove authorization check");
    const evidence = await collectSecurityReviewGitEvidence({ workspaceRoot, scopeRoot: workspaceRoot,
      stateDir: join(workspaceRoot, ".kota"), reviewState, runCommand: runGitEvidenceCommand });
    const due = inspectSecurityReviewDue(workspaceRoot, { stateDir: join(workspaceRoot, ".kota"), cooldownMs: 0 }, evidence);
    expect(due.due).toBe(true);
    expect(due.changedSurfaces).toEqual([{ surface: "auth-approval-boundary", paths: [path] }]);
    const scan = scanSecurityReviewCandidatesInWorker({ workspaceRoot, runDirPath: join(workspaceRoot, ".kota/review"),
      trigger: { event: "autonomy.security-review.due", payload: {} }, paths: evidence.changedPaths, previousSurfaces: evidence.previousSurfaces });
    expect(scan.candidates).toMatchObject([{ path, surface: "auth-approval-boundary", matcher: "changed-boundary" }]);
    expect(evidence.contentDigests[path]).toBe(change === "delete" ? "deleted" : git(["rev-parse", `HEAD:${path}`]));
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

  it("does not suppress distinct changed boundaries because a security task is open", async () => {
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

    expect(decision.due).toBe(true);
    expect(decision.reason).toBe("security-sensitive-change");
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
