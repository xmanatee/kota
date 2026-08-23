import { mkdirSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowClient } from "./client.js";
import workflowOpsModule from "./index.js";

export function makeWorkflowOpsProjectDir(): string {
  const dir = join(
    tmpdir(),
    `kota-wf-local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, ".kota"), { recursive: true });
  return realpathSync(dir);
}

export function buildLocalWorkflowHandler(
  projectDir: string,
  overrides?: Partial<ModuleContext>,
): WorkflowClient {
  const ctx = { cwd: projectDir, ...(overrides ?? {}) } as ModuleContext;
  const handlers = workflowOpsModule.localClient!(ctx);
  if (!handlers.workflow) throw new Error("workflow handler missing");
  return handlers.workflow;
}
