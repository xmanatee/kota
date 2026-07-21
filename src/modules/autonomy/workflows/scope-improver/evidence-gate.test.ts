import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deadLetterStoreForProject } from "#core/daemon/dead-letter-queue.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { SOURCE_FILE_SIZE_WARNING_TYPE } from "#modules/autonomy/source-size-check.js";
import {
  inspectScopeImprovementEvidenceGate,
  recordScopeImprovementEvidenceReady,
  scopeImprovementEvidenceWeight,
} from "./evidence-gate.js";

const NOW = new Date("2026-06-20T00:00:00.000Z");

function makeProject(): string {
  return join(
    tmpdir(),
    `kota-scope-evidence-gate-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`,
  );
}

function writeRunMetadata(
  projectDir: string,
  runId: string,
  metadata: {
    workflow: string;
    status: string;
    triggerEvent?: string;
    warnings?: { type: string; message: string }[];
  },
): void {
  const runDir = join(projectDir, ".kota", "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    `${JSON.stringify(
      {
        id: runId,
        workflow: metadata.workflow,
        status: metadata.status,
        trigger: {
          event: metadata.triggerEvent ?? "workflow.completed",
          schemaRef: null,
          payload: {},
        },
        startedAt: NOW.toISOString(),
        completedAt: NOW.toISOString(),
        runDir: `.kota/runs/${runId}`,
        steps: [],
        ...(metadata.warnings ? { warnings: metadata.warnings } : {}),
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

function writeOversizedSummary(projectDir: string, runId: string): void {
  writeFileSync(
    join(projectDir, ".kota", "runs", runId, "run-summary.json"),
    `${JSON.stringify(
      {
        warnings: [
          {
            type: SOURCE_FILE_SIZE_WARNING_TYPE,
            file: "src/modules/example/large.ts",
            lines: 420,
            threshold: 300,
            changedLines: 12,
            message: "large file",
          },
        ],
      },
      null,
      2,
    )}\n`,
    "utf-8",
  );
}

function writeOpenDeadLetter(projectDir: string): void {
  const scopeId = deriveDirectoryScopeId(projectDir);
  deadLetterStoreForProject(projectDir).record({
    type: "workflow-dispatch",
    scopeId,
    projectId: scopeId,
    owningModule: "workflow-runtime",
    sourceEventIds: [],
    affectedWorkflowNames: ["builder"],
    failure: {
      reason: "builder failed",
      lastErrorClass: "execution",
      failedAt: NOW.toISOString(),
    },
    source: {
      kind: "workflow-dispatch",
      workflowName: "builder",
      triggerEvent: "autonomy.queue.available",
      triggerSchemaRef: null,
    },
    redrive: { kind: "none", reason: "test fixture" },
    redactedProjection: {},
    retention: { kind: "retain" },
  });
}

describe("scope-improver evidence gate", () => {
  const projectDirs: string[] = [];

  afterEach(() => {
    for (const projectDir of projectDirs.splice(0)) {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  function track(): string {
    const projectDir = makeProject();
    projectDirs.push(projectDir);
    return projectDir;
  }

  it("scores raw file and task churn as zero-weight evidence", () => {
    expect(scopeImprovementEvidenceWeight("file-churn")).toBe(0);
    expect(scopeImprovementEvidenceWeight("task-churn")).toBe(0);
    expect(scopeImprovementEvidenceWeight("failed-run")).toBeGreaterThan(0);
    expect(scopeImprovementEvidenceWeight("dead-letter")).toBeGreaterThan(0);
    expect(scopeImprovementEvidenceWeight("recovery")).toBeGreaterThan(0);
    expect(scopeImprovementEvidenceWeight("repeated-warning")).toBeGreaterThan(0);
    expect(scopeImprovementEvidenceWeight("oversized-source")).toBeGreaterThan(0);
  });

  it("builds evidence-ready payloads from durable weighted sources", () => {
    const projectDir = track();
    writeRunMetadata(projectDir, "2026-06-20T00-00-00-000Z-builder-failed", {
      workflow: "builder",
      status: "failed",
    });
    writeRunMetadata(projectDir, "2026-06-20T00-01-00-000Z-builder-recovery", {
      workflow: "builder",
      status: "success",
      triggerEvent: "runtime.recovered",
    });
    for (const index of [0, 1, 2]) {
      writeRunMetadata(projectDir, `2026-06-20T00-02-0${index}-000Z-builder-warning`, {
        workflow: "builder",
        status: "completed-with-warnings",
        warnings: [{ type: "critic-review", message: "critic unavailable" }],
      });
    }
    writeRunMetadata(projectDir, "2026-06-20T00-03-00-000Z-builder-size", {
      workflow: "builder",
      status: "success",
    });
    writeOversizedSummary(projectDir, "2026-06-20T00-03-00-000Z-builder-size");
    writeOpenDeadLetter(projectDir);

    const result = inspectScopeImprovementEvidenceGate({ projectDir, now: NOW });

    expect(result.shouldEmit).toBe(true);
    expect(result.payload).not.toBeNull();
    const payload = result.payload!;
    const kinds = new Set(payload.sources.map((item) => item.kind));
    expect(kinds).toEqual(
      new Set([
        "failed-run",
        "dead-letter",
        "recovery",
        "repeated-warning",
        "oversized-source",
      ]),
    );
    expect(payload.sources.every((item) => item.weight > 0)).toBe(true);
    expect(payload.evidenceIds).toEqual(payload.sources.map((item) => item.id));
    expect(payload.reason).toContain("totalWeight=");
    expect(payload.dedupeSignature).toMatch(/^scope-evidence:[a-f0-9]+$/);
  });

  it("records evidence-ready signatures before scope-improver can enqueue again", () => {
    const projectDir = track();
    writeRunMetadata(projectDir, "2026-06-20T00-00-00-000Z-builder-failed", {
      workflow: "builder",
      status: "failed",
    });

    const first = inspectScopeImprovementEvidenceGate({ projectDir, now: NOW });
    expect(first.shouldEmit).toBe(true);
    recordScopeImprovementEvidenceReady({
      projectDir,
      payload: first.payload!,
    });

    const second = inspectScopeImprovementEvidenceGate({ projectDir, now: NOW });
    expect(second.shouldEmit).toBe(false);
    expect(second.reason).toContain("duplicate scope-improvement evidence signature");
    expect(second.payload?.dedupeSignature).toBe(first.payload?.dedupeSignature);
  });
});
