import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyAutonomyIssueObservations,
  buildAutonomyIssueObservation,
  emptyAutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import { executeDeterministicRecovery } from "./deterministic-recovery.js";

describe("improver deterministic recovery", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("executes and verifies only the allowlisted doctor repair", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-improver-recovery-"));
    roots.push(scopeRoot);
    mkdirSync(join(scopeRoot, ".kota"), { recursive: true });
    writeFileSync(
      join(scopeRoot, ".kota", "daemon-control.json"),
      JSON.stringify({ pid: Number.MAX_SAFE_INTEGER }),
      "utf-8",
    );
    const issue = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [buildAutonomyIssueObservation({
        kind: "present",
        rootCauseKey: "operator-inbox:runtime:daemon-control-stale",
        observedAt: "2026-09-03T10:00:00.000Z",
        signalIds: ["doctor-recovery"],
        source: { kind: "inbox", id: "runtime:daemon-control-stale" },
        severity: "error",
        actionability: "owner-action",
        labels: ["operator-inbox", "runtime"],
        summaries: ["The daemon control file refers to a dead process."],
        evidenceRefs: [{ kind: "artifact", ref: ".kota/daemon-control.json" }],
        observationCount: 1,
      })],
    }).projection.issues[0]!;

    const result = executeDeterministicRecovery({
      scopeRoot,
      issue,
      action: "doctor.fix",
    });

    expect(result.repairs.some((repair) => repair.action === "repaired")).toBe(true);
    expect(result.verification.every((repair) => repair.action === "skipped")).toBe(true);
    expect(existsSync(join(scopeRoot, ".kota", "modules"))).toBe(true);

    const resumed = executeDeterministicRecovery({
      scopeRoot,
      issue,
      action: "doctor.fix",
    });
    expect(resumed.repairs.every((repair) => repair.action === "skipped")).toBe(true);
    expect(resumed.verification).toEqual(resumed.repairs);
  });

  it("rejects runtime conditions that doctor does not inspect or repair", () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-improver-recovery-"));
    roots.push(scopeRoot);
    const issue = applyAutonomyIssueObservations({
      current: emptyAutonomyIssueProjection(),
      observations: [buildAutonomyIssueObservation({
        kind: "present",
        rootCauseKey: "operator-inbox:runtime:offline-workflow-store",
        observedAt: "2026-09-03T10:00:00.000Z",
        signalIds: ["unverified-doctor-recovery"],
        source: { kind: "inbox", id: "runtime:offline-workflow-store" },
        severity: "error",
        actionability: "owner-action",
        labels: ["operator-inbox", "runtime", "workflow-store"],
        summaries: ["The offline workflow store cannot be read."],
        evidenceRefs: [{ kind: "artifact", ref: ".kota/kota.sqlite" }],
        observationCount: 1,
      })],
    }).projection.issues[0]!;

    expect(() => executeDeterministicRecovery({
      scopeRoot,
      issue,
      action: "doctor.fix",
    })).toThrow("is not allowlisted");
  });
});
