import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectTrajectoryPatterns,
  legacyCleanArtifact,
  makeTrajectoryDiagnosticScopeRoot,
  seedTrajectoryRun,
  supportedArtifactWithUnsupportedDiagnostic,
} from "./trajectory-diagnostic-escalation.test-helpers.js";

describe("detectRecurringTrajectoryDiagnosticPatterns", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = makeTrajectoryDiagnosticScopeRoot();
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("emits no patterns for clean no-warning trajectory artifacts", () => {
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T09-00-00-000Z-builder-clean-a",
      hoursAgo: 3,
      code: null,
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T10-00-00-000Z-builder-clean-b",
      hoursAgo: 2,
      code: null,
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T11-00-00-000Z-builder-clean-c",
      hoursAgo: 1,
      code: null,
    });

    expect(detectTrajectoryPatterns(workspaceRoot)).toEqual([]);
  });

  it("keeps isolated advisory warnings below the escalation threshold", () => {
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T09-00-00-000Z-builder-isolated-a",
      hoursAgo: 3,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T10-00-00-000Z-builder-isolated-b",
      hoursAgo: 2,
      code: null,
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T11-00-00-000Z-builder-isolated-c",
      hoursAgo: 1,
      code: null,
    });

    expect(detectTrajectoryPatterns(workspaceRoot)).toEqual([]);
  });

  it("does not escalate repeated unsupported harness capability artifacts", () => {
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T09-00-00-000Z-builder-unsupported-a",
      hoursAgo: 3,
      code: "unsupported_trajectory",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T10-00-00-000Z-builder-unsupported-b",
      hoursAgo: 2,
      code: "unsupported_trajectory",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T11-00-00-000Z-builder-unsupported-c",
      hoursAgo: 1,
      code: "unsupported_trajectory",
    });

    expect(detectTrajectoryPatterns(workspaceRoot)).toEqual([]);
  });

  it("keeps the explorer unsupported_trajectory fingerprint below the escalation gate", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(workspaceRoot, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-explorer-unsupported-${index}`,
        hoursAgo: 3 - index,
        code: "unsupported_trajectory",
        workflow: "explorer",
        stepId: "explore",
      });
    }

    const patterns = detectTrajectoryPatterns(workspaceRoot);

    expect(patterns).toEqual([]);
    expect(JSON.stringify(patterns)).not.toContain(
      "trajectory-diagnostic:explorer:explore:unsupported_trajectory",
    );
  });

  it("keeps the improver unsupported_trajectory fingerprint below the escalation gate", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(workspaceRoot, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-improver-unsupported-${index}`,
        hoursAgo: 3 - index,
        code: "unsupported_trajectory",
        workflow: "improver",
        stepId: "improve",
      });
    }

    const patterns = detectTrajectoryPatterns(workspaceRoot);

    expect(patterns).toEqual([]);
    expect(JSON.stringify(patterns)).not.toContain(
      "trajectory-diagnostic:improver:improve:unsupported_trajectory",
    );
  });

  it("does not escalate unsupported_trajectory codes from otherwise supported artifacts", () => {
    for (const [index, hour] of [9, 10, 11].entries()) {
      seedTrajectoryRun(workspaceRoot, {
        id: `2026-05-29T${String(hour).padStart(2, "0")}-00-00-000Z-builder-supported-unsupported-${index}`,
        hoursAgo: 3 - index,
        code: "unsupported_trajectory",
        artifact: supportedArtifactWithUnsupportedDiagnostic(),
      });
    }

    expect(detectTrajectoryPatterns(workspaceRoot)).toEqual([]);
  });

  it("treats legacy clean trajectory artifacts as empty observations", () => {
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T07-00-00-000Z-builder-legacy-a",
      hoursAgo: 5,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T08-00-00-000Z-builder-legacy-b",
      hoursAgo: 4,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T09-00-00-000Z-builder-legacy-c",
      hoursAgo: 3,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "control-monitor-coverage-gap-sample",
      hoursAgo: 1,
      code: null,
      artifact: legacyCleanArtifact(),
    });

    expect(detectTrajectoryPatterns(workspaceRoot)).toEqual([]);
  });

  it("groups repeated warnings by workflow, step, code, and detail fingerprint", () => {
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T09-00-00-000Z-builder-repeat-a",
      hoursAgo: 3,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T10-00-00-000Z-builder-repeat-b",
      hoursAgo: 2,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T11-00-00-000Z-builder-repeat-c",
      hoursAgo: 1,
      code: "missing_final_verification_after_edit",
    });

    const patterns = detectTrajectoryPatterns(workspaceRoot);

    expect(patterns).toHaveLength(1);
    expect(patterns[0]).toMatchObject({
      workflow: "builder",
      stepId: "build",
      code: "missing_final_verification_after_edit",
      runCount: 3,
      runIds: [
        "2026-05-29T09-00-00-000Z-builder-repeat-a",
        "2026-05-29T10-00-00-000Z-builder-repeat-b",
        "2026-05-29T11-00-00-000Z-builder-repeat-c",
      ],
    });
    expect(patterns[0]?.fingerprint).toContain(
      "trajectory-diagnostic:builder:build:missing_final_verification_after_edit",
    );
    expect(patterns[0]?.artifactPaths).toEqual([
      ".kota/runs/2026-05-29T09-00-00-000Z-builder-repeat-a/steps/build.trajectory-diagnostics.json",
      ".kota/runs/2026-05-29T10-00-00-000Z-builder-repeat-b/steps/build.trajectory-diagnostics.json",
      ".kota/runs/2026-05-29T11-00-00-000Z-builder-repeat-c/steps/build.trajectory-diagnostics.json",
    ]);
  });

  it("drops stale patterns after a newer clean artifact for the same workflow step", () => {
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T07-00-00-000Z-builder-stale-a",
      hoursAgo: 5,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T08-00-00-000Z-builder-stale-b",
      hoursAgo: 4,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T09-00-00-000Z-builder-stale-c",
      hoursAgo: 3,
      code: "missing_final_verification_after_edit",
    });
    seedTrajectoryRun(workspaceRoot, {
      id: "2026-05-29T11-00-00-000Z-builder-stale-clean",
      hoursAgo: 1,
      code: null,
    });

    expect(detectTrajectoryPatterns(workspaceRoot)).toEqual([]);
  });
});
