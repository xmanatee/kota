import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunMetadataAuthorityError } from "#core/workflow/run-metadata.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { registerLogsCommand } from "./logs.js";
import { registerRunShowCommand } from "./run-show.js";

describe("workflow run prefix authority errors", () => {
  const runId = "2026-09-02T00-00-00-000Z-builder-attention";
  let previousCwd: string;
  let scopeRoot: string;
  let ctx: ModuleContext;

  beforeEach(() => {
    previousCwd = process.cwd();
    scopeRoot = mkdtempSync(join(tmpdir(), "kota-run-prefix-authority-"));
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
    ctx = {
      cwd: scopeRoot,
      client: {
        workflow: {
          status: async () => ({
            authorityCriticalRunIds: [runId],
            operationallyActiveRunIds: [],
            terminalRunIds: [],
          }),
        },
      },
    } as unknown as ModuleContext;
  });

  afterEach(() => {
    process.chdir(previousCwd);
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it.each([
    {
      name: "logs",
      register: (command: Command) => registerLogsCommand(command, ctx),
    },
    {
      name: "show",
      register: (command: Command) =>
        registerRunShowCommand(command, ctx),
    },
  ])(
    "preserves the canonical diagnostic from $name prefix lookup",
    async ({ register, name }) => {
      const command = new Command("workflow");
      command.exitOverride();
      register(command);

      let error: unknown;
      try {
        await command.parseAsync([name, "2026-09-02"], { from: "user" });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(WorkflowRunMetadataAuthorityError);
      expect((error as Error).message).toContain("Recovery:");
    },
  );
});
