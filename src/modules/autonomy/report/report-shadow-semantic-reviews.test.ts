import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReportCommand } from "./report-cli.js";

async function captureStdout(fn: () => Promise<void> | void): Promise<string> {
  const chunks: string[] = [];
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((data: string | Uint8Array) => {
      chunks.push(
        typeof data === "string" ? data : Buffer.from(data).toString("utf-8"),
      );
      return true;
    });
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.addCommand(buildReportCommand());
  return program;
}

function writeRunMetadata(projectDir: string, args: {
  id: string;
  workflow: string;
  startedAt?: string;
  completedAt?: string;
}): string {
  const runDir = join(projectDir, ".kota", "runs", args.id);
  mkdirSync(runDir, { recursive: true });
  const startedAt = args.startedAt ?? new Date().toISOString();
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify(
      {
        id: args.id,
        workflow: args.workflow,
        status: "success",
        startedAt,
        completedAt: args.completedAt ?? startedAt,
        durationMs: 1_000,
        totalCostUsd: 0,
        steps: [],
      },
      null,
      2,
    ),
    "utf-8",
  );
  return runDir;
}

function writeShadowReviewArtifact(runDir: string, file: string, attrs: {
  workflow: string;
  status?: "reviewed" | "skipped" | "malformed" | "error";
  decision?: "pass" | "warn" | "fail" | "skip" | "error";
  findings?: Array<{
    severity: "info" | "warning" | "critical";
    summary: string;
    citedArtifacts: string[];
    falsePositive: boolean;
  }>;
  skippedReason?: string;
  costUsd?: number | null;
  durationMs?: number | null;
}): void {
  const dir = join(runDir, "shadow-review");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, file),
    JSON.stringify(
      {
        schemaVersion: 1,
        artifactType: "shadow-semantic-review",
        runId: runDir.split("/").at(-1),
        workflow: attrs.workflow,
        generatedAt: new Date().toISOString(),
        declarationId: file.replace(/\.json$/, ""),
        reviewerProfileId: "fixture-reviewer-v1",
        reviewerPromptHash: "abcdef123456",
        mode: "advisory",
        targetKind: attrs.workflow === "research-retry" ? "source-decision" : "task-queue",
        promotionCandidateRef:
          "task-run-shadow-semantic-reviewers-for-non-builder-auto#fixture",
        status: attrs.status ?? "reviewed",
        decision: attrs.decision ?? "pass",
        target: {
          id: "target-fixture",
          summary: "Fixture target",
          artifactPaths: ["git:staged-diff"],
        },
        summary: attrs.skippedReason ?? "Fixture review summary.",
        citedArtifacts: ["git:staged-diff"],
        findings: attrs.findings ?? [],
        ...(attrs.skippedReason ? { skippedReason: attrs.skippedReason } : {}),
        costUsd: attrs.costUsd ?? null,
        durationMs: attrs.durationMs ?? null,
      },
      null,
      2,
    ),
    "utf-8",
  );
}

describe("kota report shadow semantic reviews", () => {
  let projectDir: string;
  let origCwd: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "kota-report-shadow-review-"));
    mkdirSync(join(projectDir, ".kota", "runs"), { recursive: true });
    origCwd = process.cwd();
    process.chdir(projectDir);
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("reports catches and skipped target resolution", async () => {
    const runDir = writeRunMetadata(projectDir, {
      id: "2026-07-07T00-00-00-000Z-inbox-sorter-a",
      workflow: "inbox-sorter",
    });
    writeShadowReviewArtifact(runDir, "inbox-sorter-queue-triage.json", {
      workflow: "inbox-sorter",
      status: "reviewed",
      decision: "warn",
      findings: [
        {
          severity: "critical",
          summary: "Created a duplicate task without source trace.",
          citedArtifacts: ["git:staged-diff"],
          falsePositive: false,
        },
      ],
      costUsd: 0.04,
      durationMs: 2_000,
    });
    const skippedRunDir = writeRunMetadata(projectDir, {
      id: "2026-07-07T00-00-01-000Z-research-retry-b",
      workflow: "research-retry",
    });
    writeShadowReviewArtifact(skippedRunDir, "research-retry-source-decision.json", {
      workflow: "research-retry",
      status: "skipped",
      decision: "skip",
      skippedReason: "No selected source-decision target.",
    });

    const jsonOut = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report", "--json"]);
    });
    const parsed = JSON.parse(jsonOut.trim());
    expect(parsed.shadowSemanticReviews).toMatchObject({
      totalArtifacts: 2,
      reviewed: 1,
      catches: 1,
      skippedTargetResolution: 1,
      totalCostUsd: 0.04,
      averageDurationMs: 2000,
    });
    expect(parsed.shadowSemanticReviews.byWorkflow).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workflow: "inbox-sorter", catches: 1 }),
        expect.objectContaining({
          workflow: "research-retry",
          skippedTargetResolution: 1,
        }),
      ]),
    );

    const textOut = await captureStdout(async () => {
      await makeProgram().parseAsync(["node", "kota", "report"]);
    });
    expect(textOut).toContain("Shadow semantic reviews");
    expect(textOut).toContain("inbox-sorter");
    expect(textOut).toContain("1 catch");
    expect(textOut).toContain("No selected source-decision target.");
  });
});
