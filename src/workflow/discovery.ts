import type { AgentDef } from "../agent-types.js";
import type { WorkflowDefinitionInput, RegisteredWorkflowDefinitionInput } from "./types.js";
import {
  importModuleEntry,
  listModuleDirectories,
} from "../runtime-module-discovery.js";

type BuiltinWorkflowModule = {
  default?: WorkflowDefinitionInput;
  workflow?: WorkflowDefinitionInput;
  agent?: AgentDef;
};

async function discoverBuiltinWorkflowModules(): Promise<
  Array<{
    definitionPath: string;
    workflow: WorkflowDefinitionInput;
    agent?: AgentDef;
  }>
> {
  const baseUrl = new URL("../workflows/", import.meta.url);
  const modules: Array<{
    definitionPath: string;
    workflow: WorkflowDefinitionInput;
    agent?: AgentDef;
  }> = [];

  for (const name of listModuleDirectories(baseUrl)) {
    const moduleUrl = new URL(`${name}/`, baseUrl);
    const loaded = await importModuleEntry<BuiltinWorkflowModule>(
      moduleUrl,
      "workflow",
    );
    if (!loaded) continue;
    const workflow = loaded.default ?? loaded.workflow;
    if (!workflow) continue;
    modules.push({
      definitionPath: `src/workflows/${name}/workflow.ts`,
      workflow,
      agent: loaded.agent,
    });
  }

  return modules;
}

export async function discoverBuiltinWorkflowDefinitions(): Promise<
  RegisteredWorkflowDefinitionInput[]
> {
  const modules = await discoverBuiltinWorkflowModules();
  return modules.map(({ definitionPath, workflow }) => ({
    ...workflow,
    definitionPath,
  }));
}

export async function discoverBuiltinWorkflowAgents(): Promise<AgentDef[]> {
  const modules = await discoverBuiltinWorkflowModules();
  return modules
    .map(({ agent }) => agent)
    .filter((agent): agent is AgentDef => agent !== undefined);
}

export async function discoverRegisteredWorkflowDefinitions(
  contributed: readonly RegisteredWorkflowDefinitionInput[] = [],
): Promise<RegisteredWorkflowDefinitionInput[]> {
  return [...(await discoverBuiltinWorkflowDefinitions()), ...contributed];
}
