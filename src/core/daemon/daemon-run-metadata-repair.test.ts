import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recoverInterruptedRuns } from "#core/workflow/run-restart-recovery.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import { repairRetainedRunMetadataAtDaemonStartup } from "./daemon-run-metadata-repair.js";

const roots: string[] = [];

function workflow(scopeRoot: string): WorkflowDefinition {
  return {
    name: "builder",
    description: "metadata repair fixture",
    enabled: true,
    repository: "none",
    tags: [],
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    moduleRoot: scopeRoot,
    triggers: [{ event: "manual", cooldownMs: 0 }],
    steps: [{ id: "build", type: "code", run: () => undefined }],
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("daemon startup run metadata repair", () => {
  it("repairs restart-recovered runs without parsing malformed terminal history", async () => {
    const scopeRoot = mkdtempSync(join(tmpdir(), "kota-daemon-metadata-repair-"));
    roots.push(scopeRoot);
    const stateDir = join(scopeRoot, ".kota", "state");
    const runState = new RunStateDatabase(stateDir);
    const runStore = new WorkflowRunStore(scopeRoot, { stateDir });
    const scopeId = "scope-a";
    const terminalRunId = "2026-09-03T07-00-00-000Z-builder-terminal";
    const activeRunId = "2026-09-03T08-00-00-000Z-builder-active";
    const trigger = { event: "manual", schemaRef: null, payload: {} } as const;
    const definition = workflow(scopeRoot);
    try {
      runState.registerScope({
        id: scopeId,
        rootPath: scopeRoot,
        createdAt: "2026-09-03T06:59:00.000Z",
      });
      const { epoch } = runState.beginDaemonSession(
        "2026-09-03T06:59:30.000Z",
      );

      for (const [runId, admittedAt] of [
        [terminalRunId, "2026-09-03T06:59:59.000Z"],
        [activeRunId, "2026-09-03T07:59:59.000Z"],
      ] as const) {
        runState.admitRun({
          id: runId,
          scopeId,
          workflow: definition.name,
          repository: "none",
          trigger,
          resources: [],
          admittedAt,
        });
        runStore.createRun(definition, trigger, runId);
        runState.startRun(runId, epoch, admittedAt);
      }
      runState.finishRun(
        terminalRunId,
        epoch,
        "failed",
        "2026-09-03T07:01:00.000Z",
      );

      const terminalMetadataPath = join(
        runStore.runsDir,
        terminalRunId,
        "metadata.json",
      );
      const malformedTerminalSource = "{not-json";
      writeFileSync(terminalMetadataPath, malformedTerminalSource, "utf8");
      const activeMetadataPath = join(
        runStore.runsDir,
        activeRunId,
        "metadata.json",
      );
      const activeMetadata = JSON.parse(
        readFileSync(activeMetadataPath, "utf8"),
      ) as Record<string, unknown>;
      activeMetadata.definitionPath = 17;
      writeFileSync(activeMetadataPath, JSON.stringify(activeMetadata), "utf8");

      const restartSession = runState.beginDaemonSession(
        "2026-09-03T08:30:00.000Z",
      );
      expect(restartSession.recovered).toEqual([
        expect.objectContaining({ runId: activeRunId }),
      ]);
      await recoverInterruptedRuns({
        store: runState,
        daemonEpoch: restartSession.epoch,
        attempts: restartSession.recovered,
        now: () => "2026-09-03T08:30:01.000Z",
      });
      expect(runState.getRun(activeRunId)?.state).toBe("queued");

      expect(
        repairRetainedRunMetadataAtDaemonStartup({
          scopeId,
          runState,
          runStore,
          restartRecoveryRunIds: new Set(
            restartSession.recovered.map((attempt) => attempt.runId),
          ),
        }),
      ).toEqual([
        expect.objectContaining({ kind: "repaired", runId: activeRunId }),
      ]);
      expect(readFileSync(terminalMetadataPath, "utf8")).toBe(
        malformedTerminalSource,
      );
      expect(
        runStore.getRun(activeRunId, { authorityCritical: true }),
      ).toMatchObject({
        id: activeRunId,
        definitionPath: definition.definitionPath,
      });
      const repairEvidence = runStore.getRun(activeRunId, {
        authorityCritical: true,
      }).authorityRepair;
      expect(repairEvidence).toBeDefined();

      // The normal executor recreates retained metadata when the recovered run
      // starts its next attempt. The run-specific repair proof must survive it.
      runStore.createRun(definition, trigger, activeRunId);
      expect(
        runStore.getRun(activeRunId, { authorityCritical: true })
          .authorityRepair,
      ).toEqual(repairEvidence);
      expect(
        runStore.retainedMetadataAuthorityRepair(
          `Workflow run metadata authority is invalid at ${activeMetadataPath}: definitionPath is invalid`,
        ),
      ).toEqual({
        runId: activeRunId,
        repairedAt: repairEvidence!.repairedAt,
      });
    } finally {
      runState.close();
    }
  });
});
