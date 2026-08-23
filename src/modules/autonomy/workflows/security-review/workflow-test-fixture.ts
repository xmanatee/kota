import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
} from "./security-review.js";

export class SecurityReviewProjectFixture {
  readonly projectDir: string;

  constructor() {
    this.projectDir = join(
      tmpdir(),
      `kota-security-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(this.projectDir, { recursive: true });
    writeFileSync(join(this.projectDir, ".gitignore"), ".kota/\n", "utf-8");
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: this.projectDir,
      stdio: "ignore",
    });
    execFileSync("git", ["add", ".gitignore"], {
      cwd: this.projectDir,
      stdio: "ignore",
    });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=KOTA Test",
        "-c",
        "user.email=kota@example.invalid",
        "commit",
        "-m",
        "initial",
      ],
      { cwd: this.projectDir, stdio: "ignore" },
    );
  }

  cleanup(): void {
    rmSync(this.projectDir, { recursive: true, force: true });
  }

  writeProjectFile(path: string, content: string): void {
    const fullPath = join(this.projectDir, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  securityFindingTaskIdForClaim(claim: string): string {
    return `task-${slugifyTaskTitle(`Security review: ${claim}`)}`;
  }

  confirmedFindingForClaim(claim: string): SecurityRevalidationOutput["findings"][number] {
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

  writeTerminalSecurityTask(id: string, state: "done" | "dropped", marker: string): void {
    const path = `data/tasks/${state}/${id}.md`;
    this.writeProjectFile(
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
    execFileSync("git", ["add", path], { cwd: this.projectDir, stdio: "ignore" });
  }

  writeLegacySecurityFindingTask(args: {
    id: string;
    state: "ready" | "done" | "dropped";
    runId: string;
    claim: string;
    findingId?: string;
    candidateId?: string;
    supersededBy?: string;
  }): void {
    const findingId = args.findingId ?? "finding-terminal-task-regression";
    const candidateId = args.candidateId ??
      "task-workflow-mutation:src/modules/example.ts:12";
    const path = `data/tasks/${args.state}/${args.id}.md`;
    this.writeProjectFile(
      path,
      [
        "---",
        `id: ${args.id}`,
        `title: Security review: ${args.claim}`,
        `status: ${args.state}`,
        "priority: p2",
        "area: security",
        "task_class: Safety",
        `summary: ${args.claim}`,
        "created_at: 2026-06-19T00:00:00.000Z",
        "updated_at: 2026-06-19T00:00:00.000Z",
        "---",
        "",
        "## Problem",
        "",
        "The security-review workflow confirmed an application-security finding.",
        "",
        `claim: ${args.claim}`,
        "",
        "## Desired Outcome",
        "",
        "Keep one canonical remediation record for this stable finding.",
        "",
        "## Constraints",
        "",
        "- Preserve review provenance.",
        "",
        "## Done When",
        "",
        "- The stable finding is resolved.",
        "",
        "## Source / Intent",
        "",
        `Created by security-review workflow run ${args.runId}.`,
        "",
        `finding id: ${findingId}`,
        `candidate id: ${candidateId}`,
        "",
        "## Acceptance Evidence",
        "",
        "- Focused security-review replay.",
        ...(args.supersededBy
          ? [
              "",
              "## Superseded",
              "",
              `Superseded by \`${args.supersededBy}\` for the same stable finding identity.`,
            ]
          : []),
        "",
      ].join("\n"),
    );
    execFileSync("git", ["add", path], { cwd: this.projectDir, stdio: "ignore" });
  }
}
