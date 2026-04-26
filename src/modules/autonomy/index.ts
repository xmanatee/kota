import { fileURLToPath } from "node:url";
import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  importModuleExports,
  listModuleDirectories,
} from "#core/modules/runtime-module-discovery.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinitionInput,
} from "#core/workflow/types.js";

// Absolute path to KOTA's install root (the directory that contains `src/` in
// source mode and `dist/` in built mode). Workflow `promptPath` values are
// resolved against this root so the daemon can load KOTA-owned workflow
// prompts even when `projectDir` points at an external project.
const KOTA_INSTALL_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type AutonomyWorkflowModule = {
  default: WorkflowDefinitionInput;
  agent?: AgentDef;
};

async function discoverAutonomyWorkflowModules(): Promise<
  Array<{
    name: string;
    workflow: WorkflowDefinitionInput;
    agent?: AgentDef;
  }>
> {
  const baseUrl = new URL("./workflows/", import.meta.url);
  const modules: Array<{
    name: string;
    workflow: WorkflowDefinitionInput;
    agent?: AgentDef;
  }> = [];

  for (const name of listModuleDirectories(baseUrl)) {
    const workflowDirUrl = new URL(`${name}/`, baseUrl);
    const loaded = await importModuleExports<AutonomyWorkflowModule>(
      workflowDirUrl,
      "workflow",
    );
    if (!loaded) {
      throw new Error(`Autonomy workflow "${name}" must provide workflow.ts`);
    }
    if (!loaded.default) {
      throw new Error(`Autonomy workflow "${name}" must export a default workflow definition`);
    }
    modules.push({
      name,
      workflow: loaded.default,
      agent: loaded.agent,
    });
  }

  return modules;
}

async function discoverAutonomyWorkflowDefinitions(): Promise<
  RegisteredWorkflowDefinitionInput[]
> {
  const modules = await discoverAutonomyWorkflowModules();
  return modules.map(({ name, workflow }) => ({
    ...workflow,
    definitionPath: `src/modules/autonomy/workflows/${name}/workflow.ts`,
    moduleRoot: KOTA_INSTALL_ROOT,
  }));
}

async function discoverAutonomyAgents(): Promise<AgentDef[]> {
  const modules = await discoverAutonomyWorkflowModules();
  return modules
    .map(({ agent }) => agent)
    .filter((agent): agent is AgentDef => agent !== undefined);
}

const autonomyModule: KotaModule = {
  name: "autonomy",
  version: "1.0.0",
  description: "Autonomous development workflows and their paired agents",
  dependencies: ["workflow-ops", "repo-tasks", "rendering"],
  workflows: async () => await discoverAutonomyWorkflowDefinitions(),
  agents: async () => await discoverAutonomyAgents(),
};

export default autonomyModule;
