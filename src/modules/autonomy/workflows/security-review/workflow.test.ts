import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import { validatePayloadSchema } from "#core/workflow/payload-validator.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import { assertTaskQueueValid } from "#modules/repo-tasks/task-queue-validation.js";
import { SECURITY_REVIEW_DUE_EVENT } from "./due-check.js";
import {
  createOrUpdateSecurityFindingTasks,
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
  type SecurityRevalidationVerdictOutput,
  scanSecurityReviewCandidates,
  securityReviewDueTargetsFromPayload,
} from "./security-review.js";
import securityReviewWorkflow from "./workflow.js";

vi.mock("#modules/autonomy/commit.js", () => ({
  checkCommitStageable: vi.fn(() => "OK: mock stageable"),
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

  function securityFindingTaskIdForClaim(claim: string): string {
    return `task-${slugifyTaskTitle(`Security review: ${claim}`)}`;
  }

  function confirmedFindingForClaim(claim: string): SecurityRevalidationOutput["findings"][number] {
    const investigation: SecurityInvestigationOutput = decodeSecurityInvestigationOutput({
      findings: [
        {
          id: "finding-terminal-task-regression",
          candidateId: "task-workflow-mutation:src/modules/example.ts:12",
          claim,
          severity: "medium",
          affectedPath: "src/modules/example.ts",
          evidence: [
            {
              path: "src/modules/example.ts",
              line: 12,
              excerpt: "writeFileSync(taskPath, body);",
            },
          ],
          recommendedOutcome: "Create actionable ready remediation without mutating terminal task history.",
        },
      ],
    });
    const revalidation = decodeSecurityRevalidationOutputForInvestigation(
      {
        findings: [
          {
            id: "finding-terminal-task-regression",
            verdict: "confirmed",
            rationale: "The terminal task collision still leaves no actionable ready remediation.",
          },
        ],
        summary: "Confirmed terminal task suppression.",
      },
      investigation,
    );
    const finding = revalidation.findings[0];
    if (!finding) throw new Error("fixture did not produce a confirmed finding");
    return finding;
  }

  function writeTerminalSecurityTask(
    id: string,
    state: "done" | "dropped",
    marker: string,
  ): void {
    const path = `data/tasks/${state}/${id}.md`;
    writeProjectFile(
      path,
      [
        "---",
        `id: ${id}`,
        `title: ${marker}`,
        `status: ${state}`,
        "priority: p2",
        "area: security",
        `summary: ${marker}`,
        "created_at: 2026-06-19T00:00:00.000Z",
        "updated_at: 2026-06-19T00:00:00.000Z",
        "---",
        "",
        "## Problem",
        "",
        marker,
        "",
        "## Desired Outcome",
        "",
        "Keep this terminal task as historical evidence.",
        "",
        "## Constraints",
        "",
        "- Do not reopen this fixture directly.",
        "",
        "## Done When",
        "",
        "- Historical task state is preserved.",
        "",
        "## Acceptance Evidence",
        "",
        "- Historical evidence.",
        "",
      ].join("\n"),
    );
    execFileSync("git", ["add", path], { cwd: projectDir, stdio: "ignore" });
  }

  it("orders security-review commit behind the explicit preflight gate", () => {
    const stepIds = securityReviewWorkflow.steps.map((step) => step.id);

    expect(stepIds.indexOf("create-follow-up-tasks")).toBeLessThan(
      stepIds.indexOf("write-commit-message"),
    );
    expect(stepIds.indexOf("write-commit-message")).toBeLessThan(
      stepIds.indexOf("validate-before-commit"),
    );
    expect(stepIds.indexOf("validate-before-commit")).toBe(stepIds.indexOf("commit") - 1);
  });

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

  it("prioritizes due targets before lower-priority full-tree candidates and reports misses", () => {
    writeProjectFile("src/modules/web-access/a-full-tree.ts", "await fetch('https://noise.example');\n");
    writeProjectFile("src/modules/web-access/z-due.ts", "await fetch(url, { headers });\n");
    writeProjectFile("notes/no-matcher.md", "No security-sensitive content here.\n");
    writeProjectFile("node_modules/generated.ts", "await fetch('https://ignored.example');\n");

    const dueTargets = securityReviewDueTargetsFromPayload(projectDir, {
      changedSurfaces: [
        {
          surface: "external-fetch",
          paths: [
            "src/modules/web-access/z-due.ts",
            "notes/no-matcher.md",
            "node_modules/generated.ts",
            "../outside.ts",
          ],
        },
      ],
    });

    const result = scanSecurityReviewCandidates(projectDir, {
      maxCandidates: 1,
      maxCandidatesPerSurface: 1,
      dueTargets,
    });

    expect(result.candidates.map((candidate) => candidate.path)).toEqual([
      "src/modules/web-access/z-due.ts",
    ]);
    expect(result.dueTargets).toMatchObject({
      total: 3,
      matched: 1,
      missed: 2,
    });
    expect(result.dueTargets.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surface: "external-fetch",
          path: "src/modules/web-access/z-due.ts",
          status: "matched",
        }),
        expect.objectContaining({
          surface: "external-fetch",
          path: "notes/no-matcher.md",
          status: "missed",
          reason: "no-matcher",
        }),
        expect.objectContaining({
          surface: "external-fetch",
          path: "node_modules/generated.ts",
          status: "missed",
          reason: "skipped-directory",
        }),
      ]),
    );
  });

  it("reports due target cap misses when caps are exhausted by earlier due candidates", () => {
    writeProjectFile("src/modules/web-access/a-due.ts", "await fetch(first);\n");
    writeProjectFile("src/modules/web-access/b-due.ts", "await fetch(second);\n");

    const dueTargets = securityReviewDueTargetsFromPayload(projectDir, {
      changedSurfaces: [
        {
          surface: "external-fetch",
          paths: [
            "src/modules/web-access/a-due.ts",
            "src/modules/web-access/b-due.ts",
          ],
        },
      ],
    });

    const result = scanSecurityReviewCandidates(projectDir, {
      maxCandidates: 1,
      maxCandidatesPerSurface: 1,
      dueTargets,
    });

    expect(result.candidates.map((candidate) => candidate.path)).toEqual([
      "src/modules/web-access/a-due.ts",
    ]);
    expect(result.dueTargets).toMatchObject({
      total: 2,
      matched: 1,
      missed: 1,
    });
    expect(result.dueTargets.diagnostics).toContainEqual(
      expect.objectContaining({
        surface: "external-fetch",
        path: "src/modules/web-access/b-due.ts",
        status: "missed",
        reason: "candidate-cap",
      }),
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

  it("resets recovery state without decoding skipped agent outputs", async () => {
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");

    const harness = new WorkflowTestHarness(securityReviewWorkflow, {
      projectDir,
      trigger: { event: "runtime.recovered", payload: {} },
      stepMocks: {},
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["reset-for-recovery"].status).toBe("success");
    expect(result.steps["scan-candidates"].status).toBe("skipped");
    expect(result.steps["investigate-candidates"].status).toBe("skipped");
    expect(result.steps["record-investigation-findings"].status).toBe("skipped");
    expect(result.steps["record-no-findings"].status).toBe("skipped");
    expect(result.steps["revalidate-findings"].status).toBe("skipped");
    expect(result.steps["record-revalidation"].status).toBe("skipped");
    expect(result.steps["create-follow-up-tasks"].status).toBe("skipped");
  });

  it("accepts due events while retaining the manual request trigger", async () => {
    expect(securityReviewWorkflow.triggers.map((trigger) => trigger.event)).toEqual(
      expect.arrayContaining([
        "autonomy.security-review.requested",
        SECURITY_REVIEW_DUE_EVENT,
      ]),
    );

    const harness = new WorkflowTestHarness(securityReviewWorkflow, {
      projectDir,
      trigger: { event: SECURITY_REVIEW_DUE_EVENT, payload: {} },
      stepMocks: {},
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["record-empty-scan"].status).toBe("success");
  });

  it("writes due target diagnostics into the candidate artifact for due events", async () => {
    writeProjectFile("src/modules/web-access/a-full-tree.ts", "await fetch('https://noise.example');\n");
    writeProjectFile("src/modules/web-access/z-due.ts", "await fetch(url, { headers });\n");
    writeProjectFile("notes/no-matcher.md", "No security-sensitive content here.\n");

    const harness = new WorkflowTestHarness(securityReviewWorkflow, {
      projectDir,
      trigger: {
        event: SECURITY_REVIEW_DUE_EVENT,
        payload: {
          changedSurfaces: [
            {
              surface: "external-fetch",
              paths: [
                "src/modules/web-access/z-due.ts",
                "notes/no-matcher.md",
              ],
            },
          ],
        },
      },
      stepMocks: {
        "investigate-candidates": { findings: [] },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    const artifact = JSON.parse(
      readFileSync(
        join(projectDir, ".kota/runs/harness/security-review-candidates.json"),
        "utf-8",
      ),
    ) as {
      candidates: Array<{ path: string }>;
      dueTargets: {
        total: number;
        matched: number;
        missed: number;
        diagnostics: Array<{ path: string; status: string; reason?: string }>;
      };
    };
    expect(artifact.candidates[0]?.path).toBe("src/modules/web-access/z-due.ts");
    expect(artifact.dueTargets).toMatchObject({
      total: 2,
      matched: 1,
      missed: 1,
    });
    expect(artifact.dueTargets.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "src/modules/web-access/z-due.ts",
          status: "matched",
        }),
        expect.objectContaining({
          path: "notes/no-matcher.md",
          status: "missed",
          reason: "no-matcher",
        }),
      ]),
    );
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
              id: investigation.findings[0].id,
              verdict: "confirmed",
              rationale: "The call accepts caller-provided URL data and has no local allowlist.",
            },
            {
              id: investigation.findings[1].id,
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

  it("creates a new ready task when a repeated confirmed finding has a previous done task", () => {
    const claim = "Terminal task suppresses repeated confirmed findings.";
    const baseId = securityFindingTaskIdForClaim(claim);
    writeTerminalSecurityTask(baseId, "done", "previous done finding task");

    const result = createOrUpdateSecurityFindingTasks(projectDir, {
      runId: "security-review-run",
      findings: [confirmedFindingForClaim(claim)],
    });

    expect(result.createdTaskIds).toEqual([`${baseId}-2`]);
    expect(result.updatedTaskIds).toEqual([]);
    const terminalPath = join(projectDir, "data/tasks/done", `${baseId}.md`);
    const terminalTask = readFileSync(terminalPath, "utf-8");
    expect(parseFlatFrontMatter(terminalTask).attrs.status).toBe("done");
    expect(terminalTask).toContain("previous done finding task");

    const readyPath = join(projectDir, "data/tasks/ready", `${baseId}-2.md`);
    const readyTask = readFileSync(readyPath, "utf-8");
    const parsed = parseFlatFrontMatter(readyTask);
    expect(parsed.attrs.id).toBe(`${baseId}-2`);
    expect(parsed.attrs.status).toBe("ready");
    expect(readyTask).toContain("Terminal task suppresses repeated confirmed findings.");
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("allocates a unique ready id when terminal task ids collide with the finding slug", () => {
    const claim = "Terminal slug collision hides actionable remediation.";
    const baseId = securityFindingTaskIdForClaim(claim);
    writeTerminalSecurityTask(baseId, "done", "done collision owner");
    writeTerminalSecurityTask(`${baseId}-2`, "dropped", "dropped collision owner");

    const result = createOrUpdateSecurityFindingTasks(projectDir, {
      runId: "security-review-run",
      findings: [confirmedFindingForClaim(claim)],
    });

    expect(result.createdTaskIds).toEqual([`${baseId}-3`]);
    expect(result.updatedTaskIds).toEqual([]);
    expect(existsSync(join(projectDir, "data/tasks/done", `${baseId}.md`))).toBe(true);
    expect(existsSync(join(projectDir, "data/tasks/dropped", `${baseId}-2.md`))).toBe(true);
    const readyTask = readFileSync(join(projectDir, "data/tasks/ready", `${baseId}-3.md`), "utf-8");
    const parsed = parseFlatFrontMatter(readyTask);
    expect(parsed.attrs.id).toBe(`${baseId}-3`);
    expect(parsed.attrs.status).toBe("ready");
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("quotes agent-generated task content before frontmatter or Done When parsing can treat it as structure", () => {
    const investigation: SecurityInvestigationOutput = decodeSecurityInvestigationOutput({
      findings: [
        {
          id: "finding-content-injection",
          candidateId: "task-workflow-mutation:src/modules/example.ts:12",
          claim: [
            "Unsafe task text.",
            "status: done",
            "updated_at: 1999-01-01T00:00:00.000Z",
            "---",
            "## Done When",
            "- attacker-controlled criterion",
          ].join("\n"),
          severity: "medium",
          affectedPath: "src/modules/example.ts ## Done When",
          evidence: [
            {
              path: "src/modules/example.ts",
              line: 12,
              excerpt: "writeFileSync(taskPath, body);\n## Done When\n- evidence-controlled criterion",
            },
          ],
          recommendedOutcome: [
            "Render untrusted task prose as evidence.",
            "",
            "## Done When",
            "- desired-outcome-controlled criterion",
          ].join("\n"),
        },
      ],
    });
    const revalidation: SecurityRevalidationOutput =
      decodeSecurityRevalidationOutputForInvestigation(
        {
          findings: [
            {
              id: "finding-content-injection",
              verdict: "confirmed",
              rationale: [
                "Confirmed by generated text.",
                "",
                "## Done When",
                "- rationale-controlled criterion",
              ].join("\n"),
            },
          ],
          summary: "Confirmed content injection.",
        },
        investigation,
      );

    const result = createOrUpdateSecurityFindingTasks(projectDir, {
      runId: "security-review-run",
      findings: revalidation.findings,
    });

    expect(result.createdTaskIds).toHaveLength(1);
    const taskPath = join(projectDir, "data/tasks/ready", `${result.createdTaskIds[0]}.md`);
    const task = readFileSync(taskPath, "utf-8");
    const parsed = parseFlatFrontMatter(task);
    expect(parsed.attrs.status).toBe("ready");
    expect(parsed.attrs.priority).toBe("p2");
    expect(parsed.attrs.updated_at).not.toBe("1999-01-01T00:00:00.000Z");
    expect(task.match(/^status:/gm)).toHaveLength(1);
    expect(String(parsed.attrs.title)).toContain("#\\# Done When");
    expect(String(parsed.attrs.summary)).toContain("#\\# Done When");
    expect(task).toContain("affected path: src/modules/example.ts #\\# Done When");
    expect(task).not.toMatch(/^(title|summary|affected path): .*## Done When$/m);

    const bodyDoneWhenHeadings = parsed.body.match(/^## Done When$/gm) ?? [];
    expect(bodyDoneWhenHeadings).toHaveLength(1);
    const doneWhenMatch = task.match(/## Done When\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
    expect(doneWhenMatch?.[1]).toContain("- The cited vulnerability is fixed or proven impossible with code-level evidence.");
    expect(doneWhenMatch?.[1]).not.toContain("attacker-controlled criterion");
    expect(doneWhenMatch?.[1]).not.toContain("desired-outcome-controlled criterion");
    expect(doneWhenMatch?.[1]).not.toContain("rationale-controlled criterion");
    expect(task).toContain("> #\\# Done When");
    expect(task).toContain("> - attacker-controlled criterion");
    expect(task).toContain("> - desired-outcome-controlled criterion");
    expect(task).toContain("> - rationale-controlled criterion");
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("keeps the revalidation prompt aligned with the required summary field", () => {
    const prompt = readFileSync(new URL("./prompt.md", import.meta.url), "utf-8");

    expect(prompt).toContain("top-level `summary`");
    expect(prompt).toContain("`evidence`: an array");
    expect(prompt).toContain("Do not repeat or rewrite investigation fields");
    expect(() =>
      decodeSecurityRevalidationOutputForInvestigation(
        {
          findings: [],
          summary: "No confirmed findings.",
        },
        { findings: [] },
      ),
    ).not.toThrow();
    expect(() =>
      decodeSecurityRevalidationOutputForInvestigation(
        {
          findings: [],
        },
        { findings: [] },
      ),
    ).toThrow(/summary/);
  });

  it("declares retryable output schemas for run-observed malformed agent output", () => {
    const investigationStep = securityReviewWorkflow.steps.find((step) =>
      step.id === "investigate-candidates"
    );
    const revalidationStep = securityReviewWorkflow.steps.find((step) =>
      step.id === "revalidate-findings"
    );
    if (!investigationStep || !("outputSchema" in investigationStep)) {
      throw new Error("investigate-candidates step missing outputSchema");
    }
    if (!revalidationStep || !("outputSchema" in revalidationStep)) {
      throw new Error("revalidate-findings step missing outputSchema");
    }

    const objectEvidence = {
      findings: [
        {
          id: "finding-one",
          candidateId: "external-fetch:src/modules/web-access/web-fetch.ts:1",
          claim: "Caller-controlled URL reaches fetch without validation.",
          severity: "high",
          affectedPath: "src/modules/web-access/web-fetch.ts",
          evidence: {
            path: "src/modules/web-access/web-fetch.ts",
            line: 1,
            excerpt: "await fetch(url);",
          },
          recommendedOutcome: "Validate URL scheme and host before fetch.",
        },
      ],
    };

    expect(
      validatePayloadSchema(investigationStep.outputSchema!, objectEvidence),
    ).toContain("evidence");
    expect(
      validatePayloadSchema(investigationStep.outputSchema!, { skipped: true }),
    ).toContain("findings");
    expect(
      validatePayloadSchema(revalidationStep.outputSchema!, { findings: [] }),
    ).toContain("summary");
    expect(
      validatePayloadSchema(revalidationStep.outputSchema!, {
        findings: [
          {
            ...objectEvidence.findings[0],
            evidence: [
              {
                path: "src/modules/web-access/web-fetch.ts",
                line: 1,
                excerpt: "await fetch(url);",
              },
            ],
            verdict: "confirmed",
            rationale: "The reviewed call path is exploitable.",
          },
        ],
        summary: "Confirmed one fetch finding.",
      }),
    ).toContain("unexpected field");
    expect(
      validatePayloadSchema(revalidationStep.outputSchema!, {
        findings: [
          {
            id: "finding-one",
            verdict: "confirmed",
            rationale: "The reviewed call path is exploitable.",
          },
        ],
        summary: "Confirmed one fetch finding.",
      }),
    ).toBeNull();
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
    const revalidation: SecurityRevalidationVerdictOutput = {
      findings: [
        {
          id: investigation.findings[0].id,
          verdict: "confirmed",
          rationale: "The candidate remains exploitable after reviewing call sites.",
        },
        {
          id: investigation.findings[1].id,
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
    expect(result.steps["validate-before-commit"].status).toBe("success");
    const created = result.steps["create-follow-up-tasks"].output as { createdTaskIds: string[] };
    expect(created.createdTaskIds).toHaveLength(1);
    expect(
      readFileSync(join(projectDir, ".kota/runs/harness/security-review-revalidation.json"), "utf-8"),
    ).toContain("rejected-secret");
    const preflight = JSON.parse(
      readFileSync(join(projectDir, ".kota/runs/harness/security-review-preflight.json"), "utf-8"),
    ) as {
      ok: boolean;
      checks: Array<{ rail: string; status: string; message: string }>;
    };
    expect(preflight.ok).toBe(true);
    expect(preflight.checks.map((check) => check.rail)).toEqual([
      "task-validation",
      "scratch-artifacts",
      "commit-stageable",
      "commit-message",
    ]);
    expect(preflight.checks.every((check) => check.status === "passed")).toBe(true);
    expect(
      existsSync(join(projectDir, "data/tasks/ready", `${created.createdTaskIds[0]}.md`)),
    ).toBe(true);
    expect(() => assertTaskQueueValid(projectDir, { minReady: 0 })).not.toThrow();
  });

  it("writes preflight diagnostics and skips commit when task validation fails", async () => {
    writeProjectFile("src/modules/web-access/web-fetch.ts", "await fetch(url, { headers });\n");
    writeProjectFile(
      "data/tasks/ready/task-invalid-status.md",
      [
        "---",
        "id: task-invalid-status",
        "title: invalid status fixture",
        "status: done",
        "priority: p1",
        "area: autonomy",
        "created_at: 2026-06-19T00:00:00.000Z",
        "updated_at: 2026-06-19T00:00:00.000Z",
        "---",
        "",
        "## Problem",
        "",
        "Invalid status for validation fixture.",
        "",
      ].join("\n"),
    );

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
      ],
    };
    const revalidation: SecurityRevalidationVerdictOutput = {
      findings: [
        {
          id: investigation.findings[0].id,
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
    expect(result.steps["validate-before-commit"].status).toBe("failed");
    expect(result.steps.commit).toBeUndefined();
    const preflight = JSON.parse(
      readFileSync(join(projectDir, ".kota/runs/harness/security-review-preflight.json"), "utf-8"),
    ) as {
      ok: boolean;
      blockedBy?: string;
      checks: Array<{ rail: string; status: string; message: string }>;
    };
    expect(preflight.ok).toBe(false);
    expect(preflight.blockedBy).toBe("task-validation");
    expect(preflight.checks[0]).toMatchObject({
      rail: "task-validation",
      status: "failed",
    });
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
    const revalidation: SecurityRevalidationVerdictOutput = {
      findings: [
        {
          id: investigation.findings[0].id,
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
