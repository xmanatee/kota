import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { progressReviewRequested } from "../events.js";
import {
  collectProgressReviewEvidence,
  decodeProgressReviewAgentOutputForEvidence,
  type ProgressReviewAgentOutput,
  type ProgressReviewRunEvidence,
} from "../progress-review.js";

const NOW = new Date("2026-06-04T12:00:00.000Z");

function makeProjectDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-${label}-`));
  for (const state of ["backlog", "ready", "doing", "blocked", "done", "dropped"]) {
    mkdirSync(join(dir, "data", "tasks", state), { recursive: true });
    writeFileSync(join(dir, "data", "tasks", state, "AGENTS.md"), `# ${state}\n`);
  }
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "test"], { cwd: dir });
  return dir;
}

function reviewOutput(args: {
  verdict: ProgressReviewAgentOutput["verdict"];
  summary: string;
  localScope: Partial<ProgressReviewAgentOutput["findings"]["localScope"]>;
}): ProgressReviewAgentOutput {
  return {
    verdict: args.verdict,
    summary: args.summary,
    findings: {
      crossScope: { claims: [], followUpTasks: [] },
      localScope: { claims: [], followUpTasks: [], ...args.localScope },
    },
    ownerQuestions: [],
  };
}

function spoofedPrunedRunEvidence(args: {
  retained?: Partial<NonNullable<ProgressReviewRunEvidence["pruned"]>["retained"]>;
  provenance?: Partial<NonNullable<ProgressReviewRunEvidence["pruned"]>["provenance"]>;
}): ProgressReviewRunEvidence {
  return {
    id: "run:pruned-builder-run",
    kind: "run",
    workflow: "builder",
    status: "success",
    startedAt: "2026-06-04T11:55:00.000Z",
    summary: "spoofed",
    pruned: {
      reasonCode: "policy-pruned-payload",
      artifactType: "workflow-run",
      id: "pruned-builder-run",
      prunedAt: "2026-06-04T11:58:00.000Z",
      retained: {
        id: "pruned-builder-run",
        workflow: "builder",
        status: "success",
        startedAt: "2026-06-04T11:55:00.000Z",
        ...args.retained,
      },
      provenance: {
        workflowName: "builder",
        runId: "pruned-builder-run",
        sourceEventIds: ["evtj-pruned-builder"],
        transformedFrom: [
          { artifactType: "event-envelope", id: "evtj-pruned-builder" },
        ],
        ...args.provenance,
      },
    },
  };
}

describe("progress-review pruned run evidence", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function trackProjectDir(label: string): string {
    const dir = makeProjectDir(label);
    projectDirs.push(dir);
    return dir;
  }

  it("accepts validated policy-pruned evidence refs and rejects spoofed retained ids", () => {
    const projectDir = trackProjectDir("progress-reviewer-pruned-evidence");
    const scopeId = deriveDirectoryScopeId(projectDir);
    const runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(
      join(runsDir, "pruned-runs.jsonl"),
      `${JSON.stringify({
        artifactType: "workflow-run",
        id: "pruned-builder-run",
        prunedAt: "2026-06-04T11:58:00.000Z",
        retained: {
          id: "pruned-builder-run",
          workflow: "builder",
          status: "success",
          startedAt: "2026-06-04T11:55:00.000Z",
          completedAt: "2026-06-04T11:56:00.000Z",
        },
        provenance: {
          workflowName: "builder",
          runId: "pruned-builder-run",
          sourceEventIds: ["evtj-pruned-builder"],
          transformedFrom: [
            { artifactType: "event-envelope", id: "evtj-pruned-builder" },
          ],
        },
        payloadExpired: true,
      })}\n`,
    );

    const evidence = collectProgressReviewEvidence({
      projectDir,
      scopeDir: projectDir,
      stateDir: join(projectDir, ".kota"),
      trigger: {
        event: progressReviewRequested.name,
        schemaRef: null,
        payload: { scopeId, projectId: scopeId, windowMs: 3_600_000 },
      },
      now: NOW,
    });

    expect(evidence.runs).toEqual([
      expect.objectContaining({
        id: "run:pruned-builder-run",
        summary: expect.stringContaining("policy-pruned-payload"),
        pruned: expect.objectContaining({
          reasonCode: "policy-pruned-payload",
          artifactType: "workflow-run",
          id: "pruned-builder-run",
        }),
      }),
    ]);

    const normalized = decodeProgressReviewAgentOutputForEvidence(
      reviewOutput({
        verdict: "on-track",
        summary: "Pruned run metadata can be cited.",
        localScope: {
          claims: [
            {
              id: "pruned-run",
              claim: "The retained pruned run reference is reviewable.",
              evidenceIds: ["run:pruned-builder-run"],
              confidence: "high",
            },
          ],
        },
      }),
      evidence,
    );
    expect(normalized.findings.localScope.claims[0]?.evidenceIds).toEqual([
      "run:pruned-builder-run",
    ]);

    const citeSpoofedRun = () =>
      reviewOutput({
        verdict: "on-track",
        summary: "Spoofed retained metadata must not pass validation.",
        localScope: {
          claims: [
            {
              id: "spoofed-pruned-run",
              claim: "This cites a spoofed pruned reference.",
              evidenceIds: ["run:pruned-builder-run"],
              confidence: "low",
            },
          ],
        },
      });
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(citeSpoofedRun(), {
        evidence: [
          spoofedPrunedRunEvidence({
            retained: { id: "different-run" },
          }),
        ],
      })
    ).toThrow(/retained\.id .* does not match reference id/);
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(citeSpoofedRun(), {
        evidence: [
          spoofedPrunedRunEvidence({
            retained: { workflow: "explorer" },
            provenance: { workflowName: "explorer" },
          }),
        ],
      })
    ).toThrow(/retained\.workflow .* does not match expected builder/);
    expect(() =>
      decodeProgressReviewAgentOutputForEvidence(citeSpoofedRun(), {
        evidence: [
          spoofedPrunedRunEvidence({
            provenance: { runId: "different-run" },
          }),
        ],
      })
    ).toThrow(/provenance\.runId .* does not match reference id/);
  });
});
