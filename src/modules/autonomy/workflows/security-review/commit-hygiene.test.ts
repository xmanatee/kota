import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import type {
  SecurityInvestigationOutput,
  SecurityRevalidationVerdictOutput,
} from "./security-review.js";
import securityReviewWorkflow from "./workflow.js";

function initGitRepo(projectDir: string): void {
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: projectDir });
  execFileSync("git", ["config", "user.email", "test@test"], { cwd: projectDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: projectDir });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: projectDir });
}

function writeProjectFile(projectDir: string, path: string, content: string): void {
  const fullPath = join(projectDir, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

describe("security-review commit hygiene", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-security-review-commit-hygiene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    initGitRepo(projectDir);
    writeProjectFile(projectDir, ".gitignore", ".kota/\n");
    writeProjectFile(
      projectDir,
      "src/modules/web-access/web-fetch.ts",
      "export async function fetchRemote(url: string) { return fetch(url); }\n",
    );
    writeProjectFile(projectDir, "src/builder-leftover.ts", "export const value = 1;\n");
    execFileSync("git", ["add", "-A"], { cwd: projectDir });
    execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: projectDir });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it.each([
    {
      label: "unstaged",
      stageLeftover: false,
      expectedLeftoverStatus: " M src/builder-leftover.ts",
    },
    {
      label: "staged",
      stageLeftover: true,
      expectedLeftoverStatus: "M  src/builder-leftover.ts",
    },
  ])(
    "commits only security-review task files when the run starts with $label builder dirt",
    async ({ stageLeftover, expectedLeftoverStatus }) => {
      writeProjectFile(projectDir, "src/builder-leftover.ts", "export const value = 2;\n");
      if (stageLeftover) {
        execFileSync("git", ["add", "src/builder-leftover.ts"], { cwd: projectDir });
      }

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
                excerpt: "return fetch(url);",
              },
            ],
            recommendedOutcome: "Validate URL scheme and host before fetch.",
          },
        ],
      };
      const revalidation: SecurityRevalidationVerdictOutput = {
        findings: [
          {
            id: "confirmed-fetch",
            verdict: "confirmed",
            rationale: "The fetch call accepts caller-controlled URL data.",
          },
        ],
        summary: "Confirmed one fetch finding.",
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
      expect(result.steps["validate-before-commit"].status).toBe("success");
      const created = result.steps["create-follow-up-tasks"].output as {
        createdTaskIds: string[];
      };
      expect(created.createdTaskIds).toHaveLength(1);
      const taskPath = `data/tasks/ready/${created.createdTaskIds[0]}.md`;
      expect(readFileSync(join(projectDir, taskPath), "utf-8")).toContain(
        "Validate URL scheme and host before fetch.",
      );

      const committedPaths = execFileSync(
        "git",
        ["show", "--name-only", "--format=", "HEAD"],
        { cwd: projectDir, encoding: "utf-8" },
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      expect(committedPaths).toEqual([taskPath]);
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
      expect(preflight.checks.find((check) => check.rail === "commit-stageable")).toMatchObject({
        status: "passed",
        message: "OK: 1 mutated path(s) already staged",
      });

      const leftoverStatus = execFileSync(
        "git",
        ["status", "--short", "--", "src/builder-leftover.ts"],
        { cwd: projectDir, encoding: "utf-8" },
      ).trimEnd();
      expect(leftoverStatus).toBe(expectedLeftoverStatus);
    },
  );
});
