import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "#core/events/event-bus.js";
import { createRuntimeModuleLoader } from "#core/modules/module-context.test-helpers.js";
import { discoverModules } from "#core/modules/module-discovery.js";
import { createTestWorkflowRuntime } from "#core/workflow/testing/runtime-fixture.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "#core/workflow/validation.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeInstalledModule(
  scopeRoot: string,
  name: string,
  code: string,
): void {
  const moduleDir = join(scopeRoot, ".kota", "modules", name);
  mkdirSync(moduleDir, { recursive: true });
  writeFileSync(join(moduleDir, "index.mjs"), code);
}

function shippedModule(
  name: string,
  workflow: WorkflowDefinitionInput,
): { name: string; workflows: () => WorkflowDefinitionInput[] } {
  return {
    name,
    workflows: () => [workflow],
  };
}

describe("workflow contribution precedence", () => {
  let scopeRoot: string;
  let globalConfigPath: string;
  const runStates: Array<{ close(): void }> = [];

  beforeEach(() => {
    scopeRoot = join(
      tmpdir(),
      `kota-precedence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(scopeRoot, { recursive: true });
    globalConfigPath = join(scopeRoot, "machine-config.json");
    writeFileSync(globalConfigPath, JSON.stringify({ trustedScopes: [scopeRoot] }));
  });

  afterEach(async () => {
    for (const runState of runStates.splice(0)) runState.close();
    rmSync(scopeRoot, { recursive: true, force: true });
  });

  it(
    "loads and runs a non-colliding installed workflow contribution",
    async () => {
      // An installed module ships one workflow under the target scope's
      // .kota/modules/ tree. Its name does not collide with anything KOTA
      // ships, so the loader accepts it and the runtime executes it.
      writeInstalledModule(
        scopeRoot,
        "scope-heartbeat",
        `
export default {
  name: "scope-heartbeat",
  workflows: [
    {
      name: "scope-heartbeat-run",
      repository: "none",
      triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
      steps: [
        {
          id: "record-heartbeat",
          type: "code",
          run: () => ({ beat: true }),
        },
      ],
    },
  ],
};
`,
      );

      const loader = createRuntimeModuleLoader({}, false, { globalConfigPath });
      loader.setCwd(scopeRoot);
      const installed = await discoverModules(scopeRoot, false, {
        globalConfigPath,
      });
      await loader.loadAll([], installed);

      const contributed = loader.getContributedWorkflows();
      expect(contributed).toHaveLength(1);
      const [wf] = contributed;
      expect(wf.name).toBe("scope-heartbeat-run");
      expect(wf.contributingModule).toBe("scope-heartbeat");
      expect(wf.moduleSource).toBe("installed");
      // Installed modules inherit the daemon's scopeRoot as their
      // moduleRoot by default.
      expect(wf.moduleRoot).toBe(scopeRoot);

      const { runtime, runState } = createTestWorkflowRuntime({
        bus: new EventBus(),
        scopeRoot,
        idleIntervalMs: 10,
        workflows: contributed,
      });
      runStates.push(runState);

      runtime.start();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        const runsDir = join(scopeRoot, ".kota", "runs");
        if (
          existsSync(runsDir) &&
          readdirSync(runsDir).some((runId) => {
            const path = join(runsDir, runId, "metadata.json");
            if (!existsSync(path)) return false;
            return JSON.parse(readFileSync(path, "utf-8")).status === "success";
          })
        ) break;
        await wait(25);
      }
      await runtime.stop();
      await loader.unloadAll();

      const runsDir = join(scopeRoot, ".kota", "runs");
      expect(existsSync(runsDir)).toBe(true);
      const runIds = readdirSync(runsDir);
      expect(runIds.length).toBeGreaterThanOrEqual(1);
      const meta = JSON.parse(
        readFileSync(join(runsDir, runIds[0], "metadata.json"), "utf-8"),
      );
      expect(meta.workflow).toBe("scope-heartbeat-run");
      expect(meta.status).toBe("success");
      expect(meta.steps[0]?.output).toEqual({ beat: true });
    },
  );

  it(
    "rejects a name collision between a KOTA-shipped and an installed workflow",
    async () => {
      // Two modules contribute workflows under the same name. Both are
      // routed through the same loader and should fail validation at
      // runtime load time with a message that names both sides.
      writeInstalledModule(
        scopeRoot,
        "colliding-local",
        `
export default {
  name: "colliding-local",
  workflows: [
    {
      name: "shared-workflow",
      triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
      steps: [
        { id: "noop", type: "code", run: () => ({ from: "installed" }) },
      ],
    },
  ],
};
`,
      );

      const shippedWorkflow: WorkflowDefinitionInput = {
        repository: "read",
        name: "shared-workflow",
        triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
        steps: [
          { id: "noop", type: "code", run: () => ({ from: "shipped" }) },
        ],
      };

      const loader = createRuntimeModuleLoader({}, false, { globalConfigPath });
      loader.setCwd(scopeRoot);
      const installed = await discoverModules(scopeRoot, false, {
        globalConfigPath,
      });
      await loader.loadAll(
        [shippedModule("colliding-shipped", shippedWorkflow)],
        installed,
      );

      const contributed = loader.getContributedWorkflows();
      expect(contributed).toHaveLength(2);

      // Both sides carry source metadata so the error message can name them.
      const sources = contributed.map(
        (w: RegisteredWorkflowDefinitionInput) => ({
          mod: w.contributingModule,
          src: w.moduleSource,
        }),
      );
      expect(sources).toEqual(
        expect.arrayContaining([
          { mod: "colliding-shipped", src: "bundled" },
          { mod: "colliding-local", src: "installed" },
        ]),
      );

      let thrown: unknown = null;
      try {
        validateWorkflowDefinitions(contributed, scopeRoot);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(WorkflowDefinitionError);
      const msg = (thrown as Error).message;
      expect(msg).toContain('duplicate workflow name "shared-workflow"');
      expect(msg).toContain("colliding-shipped");
      expect(msg).toContain("bundled");
      expect(msg).toContain("colliding-local");
      expect(msg).toContain("installed");

      await loader.unloadAll();
    },
  );
});
