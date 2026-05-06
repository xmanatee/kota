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
import { discoverModules } from "#core/modules/module-discovery.js";
import { ModuleLoader } from "#core/modules/module-loader.js";
import { WorkflowRuntime } from "#core/workflow/runtime.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  validateWorkflowDefinitions,
  WorkflowDefinitionError,
} from "#core/workflow/validation.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeProjectLocalModule(
  projectDir: string,
  name: string,
  code: string,
): void {
  const moduleDir = join(projectDir, ".kota", "modules", name);
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
  let projectDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-precedence-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(async () => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it(
    "loads and runs a non-colliding project-local workflow contribution",
    async () => {
      // A project-local module ships one workflow under the target project's
      // .kota/modules/ tree. Its name does not collide with anything KOTA
      // ships, so the loader accepts it and the runtime executes it.
      writeProjectLocalModule(
        projectDir,
        "project-heartbeat",
        `
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default {
  name: "project-heartbeat",
  workflows: [
    {
      name: "project-heartbeat-run",
      triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
      steps: [
        {
          id: "write-sentinel",
          type: "code",
          run: (context) => {
            const target = join(context.projectDir, "data", "heartbeat.txt");
            mkdirSync(join(context.projectDir, "data"), { recursive: true });
            writeFileSync(target, "beat");
            return { wrote: target };
          },
        },
      ],
    },
  ],
};
`,
      );

      const loader = new ModuleLoader({});
      loader.setCwd(projectDir);
      const installed = await discoverModules(projectDir);
      await loader.loadAll([], installed);

      const contributed = loader.getContributedWorkflows();
      expect(contributed).toHaveLength(1);
      const [wf] = contributed;
      expect(wf.name).toBe("project-heartbeat-run");
      expect(wf.contributingModule).toBe("project-heartbeat");
      expect(wf.moduleSource).toBe("installed");
      // Project-local modules inherit the daemon's projectDir as their
      // moduleRoot by default.
      expect(wf.moduleRoot).toBe(projectDir);

      const runtime = new WorkflowRuntime({
        bus: new EventBus(),
        projectDir,
        idleIntervalMs: 10,
        workflows: contributed,
      });

      runtime.start();
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        if (existsSync(join(projectDir, "data", "heartbeat.txt"))) break;
        await wait(25);
      }
      await runtime.stop();
      await loader.unloadAll();

      expect(existsSync(join(projectDir, "data", "heartbeat.txt"))).toBe(true);
      expect(readFileSync(join(projectDir, "data", "heartbeat.txt"), "utf-8"))
        .toBe("beat");

      const runsDir = join(projectDir, ".kota", "runs");
      expect(existsSync(runsDir)).toBe(true);
      const runIds = readdirSync(runsDir);
      expect(runIds.length).toBeGreaterThanOrEqual(1);
      const meta = JSON.parse(
        readFileSync(join(runsDir, runIds[0], "metadata.json"), "utf-8"),
      );
      expect(meta.workflow).toBe("project-heartbeat-run");
      expect(meta.status).toBe("success");
    },
  );

  it(
    "rejects a name collision between a KOTA-shipped and a project-local workflow",
    async () => {
      // Two modules contribute workflows under the same name. Both are
      // routed through the same loader and should fail validation at
      // runtime load time with a message that names both sides.
      writeProjectLocalModule(
        projectDir,
        "colliding-local",
        `
export default {
  name: "colliding-local",
  workflows: [
    {
      name: "shared-workflow",
      triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
      steps: [
        { id: "noop", type: "code", run: () => ({ from: "project-local" }) },
      ],
    },
  ],
};
`,
      );

      const shippedWorkflow: WorkflowDefinitionInput = {
        name: "shared-workflow",
        triggers: [{ event: "runtime.idle", cooldownMs: 30_000 }],
        steps: [
          { id: "noop", type: "code", run: () => ({ from: "shipped" }) },
        ],
      };

      const loader = new ModuleLoader({});
      loader.setCwd(projectDir);
      const installed = await discoverModules(projectDir);
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
          { mod: "colliding-shipped", src: "project" },
          { mod: "colliding-local", src: "installed" },
        ]),
      );

      let thrown: unknown = null;
      try {
        validateWorkflowDefinitions(contributed, projectDir);
      } catch (err) {
        thrown = err;
      }

      expect(thrown).toBeInstanceOf(WorkflowDefinitionError);
      const msg = (thrown as Error).message;
      expect(msg).toContain('duplicate workflow name "shared-workflow"');
      expect(msg).toContain("colliding-shipped");
      expect(msg).toContain("project");
      expect(msg).toContain("colliding-local");
      expect(msg).toContain("installed");

      await loader.unloadAll();
    },
  );
});
