import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import {
  createOrUpdateSecurityFindingTasks,
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
  scanSecurityReviewCandidates,
} from "./security-review.js";
import securityReviewWorkflow from "./workflow.js";

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(() => ({ committed: true })),
}));

describe("security-review workflow", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-security-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    execFileSync("git", ["init"], { cwd: projectDir, stdio: "ignore" });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  function writeProjectFile(path: string, content: string): void {
    const fullPath = join(projectDir, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  it("discovers repo-local candidates across KOTA security-sensitive surfaces", () => {
    writeProjectFile("src/modules/approval-queue/index.ts", "const approval = canUseTool({ Authorization: token });\n");
    writeProjectFile("src/core/daemon/daemon-control.ts", "router.post('/api/tasks/:id/move', handler);\n");
    writeProjectFile("src/modules/shell/index.ts", "spawnSync(command, { shell: true });\n");
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");
    writeProjectFile("src/modules/secrets/index.ts", "const apiKey = await get_secret('OPENAI_API_KEY');\n");
    writeProjectFile("src/core/mcp/client.ts", "const transport = new McpClient({ sse: true, stdio: false });\n");
    writeProjectFile("src/modules/autonomy/workflows/builder/workflow.ts", "moveTaskById(projectDir, id, 'done');\n");

    const result = scanSecurityReviewCandidates(projectDir, {
      maxCandidates: 7,
      maxCandidatesPerSurface: 1,
    });

    expect(result.truncated).toBe(false);
    expect(result.candidates).toHaveLength(7);
    expect(result.candidates.map((candidate) => candidate.surface).sort()).toEqual([
      "auth-approval-boundary",
      "daemon-control-route",
      "external-fetch",
      "mcp-transport",
      "secret-handling",
      "task-workflow-mutation",
      "tool-execution",
    ]);
    expect(result.candidates.every((candidate) => candidate.excerpt.length > 0)).toBe(true);
  });

  it("prioritizes source implementation candidates over generated and prose noise", () => {
    const noisyMatch =
      "Authorization Bearer /api/control spawnSync fetch('https://example.test') get_secret SECRET Mcp stdio moveTaskById workflow git add data/tasks\n";
    for (let index = 0; index < 5; index += 1) {
      writeProjectFile(`clients/apple/.build/generated/contract-fixture-${index}.json`, noisyMatch);
      writeProjectFile(`data/tasks/done/noisy-security-note-${index}.md`, noisyMatch);
    }
    writeProjectFile("src/modules/approval-queue/index.ts", "const approval = canUseTool({ Authorization: token });\n");
    writeProjectFile("src/core/daemon/daemon-control.ts", "router.post('/api/tasks/:id/move', handler);\n");
    writeProjectFile("src/modules/execution/shell.ts", "spawnSync(command, { shell: true });\n");
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");
    writeProjectFile("src/modules/secrets/index.ts", "const apiKey = await get_secret('OPENAI_API_KEY');\n");
    writeProjectFile("src/core/mcp/client.ts", "const transport = new McpClient({ sse: true, stdio: false });\n");
    writeProjectFile("src/modules/autonomy/workflows/builder/workflow.ts", "moveTaskById(projectDir, id, 'done');\n");

    const result = scanSecurityReviewCandidates(projectDir);
    const paths = result.candidates.map((candidate) => candidate.path);

    expect(result.maxCandidates).toBe(35);
    expect(result.maxCandidatesPerSurface).toBe(5);
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/modules/approval-queue/index.ts",
        "src/core/daemon/daemon-control.ts",
        "src/modules/execution/shell.ts",
        "src/modules/web-access/web-fetch.ts",
        "src/modules/secrets/index.ts",
        "src/core/mcp/client.ts",
        "src/modules/autonomy/workflows/builder/workflow.ts",
      ]),
    );
  });

  it("uses surface-specific source priority before lexicographic path order", () => {
    for (let index = 0; index < 5; index += 1) {
      writeProjectFile(`src/core/tools/tool-noise-${index}.ts`, "spawnSync(command, { shell: true });\n");
      writeProjectFile(`src/modules/browser/fetch-noise-${index}.ts`, "await fetch('https://example.test');\n");
      writeProjectFile(`src/core/config/secrets-noise-${index}.ts`, "const value = process.env.SECRET_TOKEN;\n");
    }
    writeProjectFile("src/modules/execution/shell.ts", "spawnSync(command, { shell: true });\n");
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");
    writeProjectFile("src/modules/secrets/index.ts", "const apiKey = await get_secret('OPENAI_API_KEY');\n");

    const result = scanSecurityReviewCandidates(projectDir);
    const paths = result.candidates.map((candidate) => candidate.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        "src/modules/execution/shell.ts",
        "src/modules/web-access/web-fetch.ts",
        "src/modules/secrets/index.ts",
      ]),
    );
  });

  it("completes as an explicit no-op when the deterministic scan is empty", async () => {
    const harness = new WorkflowTestHarness(securityReviewWorkflow, {
      projectDir,
      trigger: { event: "autonomy.security-review.requested", payload: {} },
      stepMocks: {},
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["scan-candidates"].status).toBe("success");
    expect(result.steps["record-empty-scan"].status).toBe("success");
    expect(result.steps["investigate-candidates"].status).toBe("skipped");
    expect(result.steps["revalidate-findings"].status).toBe("skipped");
    expect(result.steps["create-follow-up-tasks"].status).toBe("skipped");
    expect(
      existsSync(join(projectDir, ".kota/runs/harness/security-review-outcome.json")),
    ).toBe(true);
  });

  it("decodes investigation and revalidation output before creating confirmed follow-up tasks", () => {
    const investigation: SecurityInvestigationOutput = decodeSecurityInvestigationOutput({
      findings: [
        {
          id: "finding-confirmed",
          candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:12",
          claim: "Untrusted URL reaches fetch without an allowlist.",
          severity: "high",
          affectedPath: "src/modules/web-access/web-fetch.ts",
          evidence: [
            {
              path: "src/modules/web-access/web-fetch.ts",
              line: 12,
              excerpt: "await fetch(url)",
            },
          ],
          recommendedOutcome: "Validate URL scheme and host before fetch.",
        },
        {
          id: "finding-rejected",
          candidateId: "secret-handling:src/modules/secrets/index.ts:2",
          claim: "Secret value is printed.",
          severity: "medium",
          affectedPath: "src/modules/secrets/index.ts",
          evidence: [
            {
              path: "src/modules/secrets/index.ts",
              line: 2,
              excerpt: "return maskedSecret",
            },
          ],
          recommendedOutcome: "No code change.",
        },
      ],
    });
    const revalidation: SecurityRevalidationOutput =
      decodeSecurityRevalidationOutputForInvestigation(
        {
          findings: [
            {
              ...investigation.findings[0],
              verdict: "confirmed",
              rationale: "The call accepts caller-provided URL data and has no local allowlist.",
            },
            {
              ...investigation.findings[1],
              verdict: "rejected",
              rationale: "The evidence shows a masked placeholder, not the secret value.",
            },
          ],
          summary: "One confirmed finding and one rejected finding.",
        },
        investigation,
      );

    const result = createOrUpdateSecurityFindingTasks(projectDir, {
      runId: "security-review-run",
      findings: revalidation.findings,
    });

    expect(result.createdTaskIds).toHaveLength(1);
    expect(result.updatedTaskIds).toHaveLength(0);
    expect(result.skippedFindingIds).toEqual(["finding-rejected"]);
    const taskPath = join(projectDir, "data/tasks/ready", `${result.createdTaskIds[0]}.md`);
    const task = readFileSync(taskPath, "utf-8");
    expect(task).toContain("severity: high");
    expect(task).toContain("affected path: src/modules/web-access/web-fetch.ts");
    expect(task).toContain("Untrusted URL reaches fetch without an allowlist.");
    expect(task).toContain("Validate URL scheme and host before fetch.");
    expect(task).not.toContain("Secret value is printed.");
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("turns confirmed revalidation findings into tasks and leaves rejected findings in artifacts", async () => {
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");
    writeProjectFile("src/modules/secrets/index.ts", "const token = await get_secret('TOKEN');\n");

    const investigation: SecurityInvestigationOutput = {
      findings: [
        {
          id: "confirmed-fetch",
          candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:1",
          claim: "Caller-controlled URL reaches fetch without validation.",
          severity: "high",
          affectedPath: "src/modules/web-access/web-fetch.ts",
          evidence: [
            {
              path: "src/modules/web-access/web-fetch.ts",
              line: 1,
              excerpt: "await fetch(url, { headers });",
            },
          ],
          recommendedOutcome: "Add explicit URL validation before fetch.",
        },
        {
          id: "rejected-secret",
          candidateId: "secret-handling:src/modules/secrets/index.ts:1",
          claim: "Secret is logged.",
          severity: "medium",
          affectedPath: "src/modules/secrets/index.ts",
          evidence: [
            {
              path: "src/modules/secrets/index.ts",
              line: 1,
              excerpt: "const token = await get_secret('TOKEN');",
            },
          ],
          recommendedOutcome: "No task needed.",
        },
      ],
    };
    const revalidation: SecurityRevalidationOutput = {
      findings: [
        {
          ...investigation.findings[0],
          verdict: "confirmed",
          rationale: "The candidate remains exploitable after reviewing call sites.",
        },
        {
          ...investigation.findings[1],
          verdict: "rejected",
          rationale: "No logging sink is present.",
        },
      ],
      summary: "Confirmed fetch issue; rejected secret false positive.",
    };

    const harness = new WorkflowTestHarness(securityReviewWorkflow, {
      projectDir,
      trigger: { event: "autonomy.security-review.requested", payload: {} },
      stepMocks: {
        "investigate-candidates": investigation,
        "revalidate-findings": revalidation,
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["record-investigation-findings"].status).toBe("success");
    expect(result.steps["record-revalidation"].status).toBe("success");
    expect(result.steps["create-follow-up-tasks"].status).toBe("success");
    const created = result.steps["create-follow-up-tasks"].output as { createdTaskIds: string[] };
    expect(created.createdTaskIds).toHaveLength(1);
    expect(
      readFileSync(join(projectDir, ".kota/runs/harness/security-review-revalidation.json"), "utf-8"),
    ).toContain("rejected-secret");
    expect(
      existsSync(join(projectDir, "data/tasks/ready", `${created.createdTaskIds[0]}.md`)),
    ).toBe(true);
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("fails when revalidation omits an investigation finding", async () => {
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");
    writeProjectFile("src/modules/secrets/index.ts", "const token = await get_secret('TOKEN');\n");

    const investigation: SecurityInvestigationOutput = {
      findings: [
        {
          id: "confirmed-fetch",
          candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:1",
          claim: "Caller-controlled URL reaches fetch without validation.",
          severity: "high",
          affectedPath: "src/modules/web-access/web-fetch.ts",
          evidence: [
            {
              path: "src/modules/web-access/web-fetch.ts",
              line: 1,
              excerpt: "await fetch(url, { headers });",
            },
          ],
          recommendedOutcome: "Add explicit URL validation before fetch.",
        },
        {
          id: "missing-secret",
          candidateId: "secret-handling:src/modules/secrets/index.ts:1",
          claim: "Secret is logged.",
          severity: "medium",
          affectedPath: "src/modules/secrets/index.ts",
          evidence: [
            {
              path: "src/modules/secrets/index.ts",
              line: 1,
              excerpt: "const token = await get_secret('TOKEN');",
            },
          ],
          recommendedOutcome: "No task needed.",
        },
      ],
    };
    const revalidation: SecurityRevalidationOutput = {
      findings: [
        {
          ...investigation.findings[0],
          verdict: "confirmed",
          rationale: "The candidate remains exploitable after reviewing call sites.",
        },
      ],
      summary: "Confirmed fetch issue.",
    };

    const harness = new WorkflowTestHarness(securityReviewWorkflow, {
      projectDir,
      trigger: { event: "autonomy.security-review.requested", payload: {} },
      stepMocks: {
        "investigate-candidates": investigation,
        "revalidate-findings": revalidation,
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps["record-revalidation"].status).toBe("failed");
    expect(result.steps["record-revalidation"].error).toContain("missing-secret");
    expect(result.steps["create-follow-up-tasks"]).toBeUndefined();
  });
});
