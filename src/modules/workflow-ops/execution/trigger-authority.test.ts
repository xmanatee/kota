import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunMetadataAuthorityError } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { registerTriggerCommands } from "./trigger.js";

describe("workflow retry prefix authority errors", () => {
  const runId = "2026-09-02T00-00-00-000Z-builder-attention";
  let previousCwd: string;
  let scopeRoot: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-retry-prefix-authority-"));
    process.chdir(scopeRoot);

    const state = new RunStateDatabase(join(scopeRoot, ".kota"));
    state.registerScope({
      id: "scope-prefix-authority",
      rootPath: realpathSync(scopeRoot),
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    state.admitRun({
      id: runId,
      scopeId: "scope-prefix-authority",
      workflow: "builder",
      repository: "read",
      trigger: { event: "manual", schemaRef: null, payload: {} },
      resources: [],
      admittedAt: "2026-09-02T00:00:01.000Z",
    });
    state.requireRunAttention(runId, "recovery required", []);
    state.close();
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it("preserves the canonical diagnostic from retry prefix lookup", async () => {
    const command = new Command("workflow");
    command.exitOverride();
    registerTriggerCommands(command, {
      client: {
        workflow: {
          status: async () => ({
            authorityCriticalRunIds: [runId],
            operationallyActiveRunIds: [runId],
            terminalRunIds: [],
          }),
        },
      },
    } as unknown as ModuleContext);

    let error: unknown;
    try {
      await command.parseAsync(["retry", "2026-09-02"], { from: "user" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(WorkflowRunMetadataAuthorityError);
    expect((error as Error).message).toContain("Recovery:");
  });
});
