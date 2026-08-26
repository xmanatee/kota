import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectRuntimeHealthAuditForProject,
  makeRuntimeHealthAuditProjectDir,
  RUNTIME_HEALTH_AUDIT_NOW,
  reviewAndApplyRuntimeHealthAudit,
  runtimeHealthReadyTaskFiles,
  writeRuntimeHealthRun,
} from "./runtime-health-audit-test-context.js";

describe("runtime health audit interrupted runs", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeRuntimeHealthAuditProjectDir();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("requests one root-cause decision for repeated interrupted runs", () => {
    for (const [id, startedAt] of [
      ["run-a", "2026-06-19T10:00:00.000Z"],
      ["run-b", "2026-06-19T11:00:00.000Z"],
    ] as const) {
      writeRuntimeHealthRun(projectDir, {
        id,
        workflow: "builder",
        status: "interrupted",
        startedAt,
      });
    }

    const audit = collectRuntimeHealthAuditForProject({
      projectDir,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "workflow:builder:interrupted-run",
        category: "local-code",
        observationCount: 2,
      }),
    ]);

    const first = reviewAndApplyRuntimeHealthAudit(projectDir, audit);
    const second = reviewAndApplyRuntimeHealthAudit(projectDir, audit);
    expect(first.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "workflow:builder:interrupted-run",
      }),
    ]);
    expect(second.applied).toEqual([]);
  });

  it("routes known runtime abort interruptions outside local repair tasks", () => {
    writeRuntimeHealthRun(projectDir, {
      id: "improver-abort-a",
      workflow: "improver",
      status: "interrupted",
      startedAt: "2026-06-17T16:38:32.184Z",
      error: 'Agent step "improve" failed (aborted): Codex CLI run aborted.',
    });
    writeRuntimeHealthRun(projectDir, {
      id: "improver-abort-b",
      workflow: "improver",
      status: "interrupted",
      startedAt: "2026-06-17T16:52:59.769Z",
      error: 'Agent step "improve" failed (aborted): Codex CLI run aborted.',
    });
    writeRuntimeHealthRun(projectDir, {
      id: "improver-restart",
      workflow: "improver",
      status: "interrupted",
      startedAt: "2026-06-15T23:44:08.673Z",
      error: "Interrupted: daemon restarted while run was in progress.",
    });

    const audit = collectRuntimeHealthAuditForProject({
      projectDir,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.patterns).toEqual([
      expect.objectContaining({
        dedupeKey: "workflow:improver:interrupted-run:harness-abort",
        category: "operator-action",
        actionability: "owner-action",
        labels: expect.arrayContaining([
          "harness-abort",
          "improver",
          "interrupted-run",
          "operator-action",
        ]),
        observationCount: 2,
        evidenceRefs: expect.arrayContaining([
          expect.objectContaining({
            kind: "artifact",
            ref: ".kota/runs/improver-abort-a/error.txt",
            summary:
              'Agent step "improve" failed (aborted): Codex CLI run aborted.',
          }),
        ]),
      }),
    ]);
    expect(audit.patterns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dedupeKey: "workflow:improver:interrupted-run" }),
      ]),
    );

    const actions = reviewAndApplyRuntimeHealthAudit(projectDir, audit);
    expect(actions.applied).toEqual([
      expect.objectContaining({
        kind: "decision-requested",
        dedupeKey: "workflow:improver:interrupted-run:harness-abort",
      }),
    ]);
    expect(runtimeHealthReadyTaskFiles(projectDir)).toEqual([]);
  });

  it("suppresses interrupted runs recovered by a newer success", () => {
    for (const run of [
      {
        id: "builder-interrupted-a",
        workflow: "builder",
        status: "interrupted",
        startedAt: "2026-06-19T09:00:00.000Z",
        error: 'Agent step "build" failed (aborted): Codex CLI run aborted.',
      },
      {
        id: "builder-interrupted-b",
        workflow: "builder",
        status: "interrupted",
        startedAt: "2026-06-19T10:00:00.000Z",
        error: 'Agent step "build" failed (aborted): Codex CLI run aborted.',
      },
      {
        id: "builder-recovered",
        workflow: "builder",
        status: "success",
        startedAt: "2026-06-19T11:00:00.000Z",
      },
      {
        id: "improver-success",
        workflow: "improver",
        status: "success",
        startedAt: "2026-06-19T08:00:00.000Z",
      },
    ] as const) {
      writeRuntimeHealthRun(projectDir, run);
    }
    for (const [id, startedAt] of [
      ["improver-interrupted-a", "2026-06-19T09:00:00.000Z"],
      ["improver-interrupted-b", "2026-06-19T10:00:00.000Z"],
    ] as const) {
      writeRuntimeHealthRun(projectDir, {
        id,
        workflow: "improver",
        status: "interrupted",
        startedAt,
      });
    }

    const audit = collectRuntimeHealthAuditForProject({
      projectDir,
      options: { nowIso: RUNTIME_HEALTH_AUDIT_NOW, interruptedRunMinCount: 2 },
    });

    expect(audit.inspected.interruptedRuns).toBe(4);
    expect(audit.patterns).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey: "workflow:builder:interrupted-run:harness-abort",
        }),
      ]),
    );
    expect(audit.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dedupeKey: "workflow:improver:interrupted-run",
          observationCount: 2,
        }),
      ]),
    );
  });
});
