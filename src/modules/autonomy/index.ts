import type { AgentDef } from "../../agent-types.js";
import type { KotaModule } from "../../module-types.js";
import {
  importModuleExports,
  listModuleDirectories,
} from "../../runtime-module-discovery.js";
import type {
  RegisteredWorkflowDefinitionInput,
  WorkflowDefinitionInput,
} from "../../workflow/types.js";

type AutonomyWorkflowModule = {
  default?: WorkflowDefinitionInput;
  workflow?: WorkflowDefinitionInput;
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
    if (!loaded) continue;
    const workflow = loaded.default ?? loaded.workflow;
    if (!workflow) continue;
    modules.push({
      name,
      workflow,
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
  workflows: async () => await discoverAutonomyWorkflowDefinitions(),
  agents: async () => await discoverAutonomyAgents(),
};

export default autonomyModule;
