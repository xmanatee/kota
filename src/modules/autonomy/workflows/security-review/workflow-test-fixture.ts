import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";
import {
  decodeSecurityInvestigationOutput,
  decodeSecurityRevalidationOutputForInvestigation,
  type SecurityInvestigationOutput,
  type SecurityRevalidationOutput,
} from "./security-review.js";

export class SecurityReviewProjectFixture {
  readonly workspaceRoot: string;

  constructor() {
    this.workspaceRoot = join(
      tmpdir(),
      `kota-security-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(this.workspaceRoot, { recursive: true });
    writeFileSync(join(this.workspaceRoot, ".gitignore"), ".kota/\n", "utf-8");
    execFileSync("git", ["init", "-q", "-b", "main"], {
      cwd: this.workspaceRoot,
      stdio: "ignore",
    });
    execFileSync("git", ["add", ".gitignore"], {
      cwd: this.workspaceRoot,
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
      { cwd: this.workspaceRoot, stdio: "ignore" },
    );
  }

  cleanup(): void {
    rmSync(this.workspaceRoot, { recursive: true, force: true });
  }

  writeProjectFile(path: string, content: string): void {
    const fullPath = join(this.workspaceRoot, path);
    mkdirSync(join(fullPath, ".."), { recursive: true });
    writeFileSync(fullPath, content, "utf-8");
  }

  commitProjectState(
    message = "scenario input",
    workspaceRoot = this.workspaceRoot,
  ): void {
    execFileSync("git", ["add", "-A"], {
      cwd: workspaceRoot,
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
        "--quiet",
        "-m",
        message,
      ],
      { cwd: workspaceRoot, stdio: "ignore" },
    );
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
          recommendedOutcome: "Create actionable remediation without mutating terminal task history.",
        },
      ],
    });
    const revalidation = decodeSecurityRevalidationOutputForInvestigation(
      {
        findings: [
          {
            id: "finding-terminal-task-regression",
            verdict: "confirmed",
            rationale: "The terminal task collision still leaves no actionable remediation.",
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
    const path = `data/tasks/archive/${id}.md`;
    const body = renderRepoTaskIntent({
      problem: marker,
      desiredOutcome: "Keep this terminal task as historical context.",
      constraints: "- Do not reopen this fixture directly.",
      howWeWillKnow: "- Historical task state is preserved.",
    });
    this.writeProjectFile(
      path,
      [
        "---",
        `status: ${state}`,
        "---",
        "",
        `# ${marker}`,
        "",
        body,
      ].join("\n"),
    );
    execFileSync("git", ["add", path], { cwd: this.workspaceRoot, stdio: "ignore" });
  }

  writeLegacySecurityFindingTask(args: {
    id: string;
    state: "open" | "done" | "dropped";
    runId: string;
    claim: string;
    findingId?: string;
    candidateId?: string;
    supersededBy?: string;
  }): void {
    const findingId = args.findingId ?? "finding-terminal-task-regression";
    const candidateId = args.candidateId ??
      "task-workflow-mutation:src/modules/example.ts:12";
    const path = args.state === "open"
      ? `data/tasks/${args.id}.md`
      : `data/tasks/archive/${args.id}.md`;
    const body = renderRepoTaskIntent({
      problem: [
        "The security-review workflow confirmed an application-security finding.",
        "",
        `claim: ${args.claim}`,
      ].join("\n"),
      desiredOutcome: "Keep one canonical remediation record for this stable finding.",
      constraints: "- Preserve review provenance.",
      howWeWillKnow: "- The stable finding is resolved at its actual security boundary.",
      context: [
        `Created by security-review workflow run ${args.runId}.`,
        "",
        `finding id: ${findingId}`,
        `candidate id: ${candidateId}`,
      ].join("\n"),
    });
    this.writeProjectFile(
      path,
      [
        "---",
        `status: ${args.state}`,
        ...(args.state === "open" ? ["priority: p2"] : []),
        "---",
        "",
        `# Security review: ${args.claim}`,
        "",
        body,
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
    execFileSync("git", ["add", path], { cwd: this.workspaceRoot, stdio: "ignore" });
  }
}
