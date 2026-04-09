import type { AgentDef } from "../agent-types.js";
import type { RegisteredWorkflowDefinitionInput } from "../workflow/types.js";
import { BUILTIN_AUTONOMY_AGENTS } from "./builtin-agents.js";
import attentionDigestWorkflow from "./attention-digest/workflow.js";
import builderWorkflow from "./builder/workflow.js";
import explorerWorkflow from "./explorer/workflow.js";
import inboxSorterWorkflow from "./inbox-sorter/workflow.js";
import improverWorkflow from "./improver/workflow.js";

type BuiltinWorkflowCatalogEntry = {
  definitionPath: string;
  workflow: Omit<RegisteredWorkflowDefinitionInput, "definitionPath">;
  agent?: AgentDef;
};

function listBuiltinWorkflowCatalog(): readonly BuiltinWorkflowCatalogEntry[] {
  const agentsByName = new Map(BUILTIN_AUTONOMY_AGENTS.map((agent) => [agent.name, agent]));

  return [
    {
      definitionPath: "src/workflows/inbox-sorter/workflow.ts",
      workflow: inboxSorterWorkflow,
      agent: agentsByName.get("inbox-sorter"),
    },
    {
      definitionPath: "src/workflows/explorer/workflow.ts",
      workflow: explorerWorkflow,
      agent: agentsByName.get("explorer"),
    },
    {
      definitionPath: "src/workflows/builder/workflow.ts",
      workflow: builderWorkflow,
      agent: agentsByName.get("builder"),
    },
    {
      definitionPath: "src/workflows/improver/workflow.ts",
      workflow: improverWorkflow,
      agent: agentsByName.get("improver"),
    },
    {
      definitionPath: "src/workflows/attention-digest/workflow.ts",
      workflow: attentionDigestWorkflow,
    },
  ] as const;
}

export function getBuiltinWorkflowDefinitions(): RegisteredWorkflowDefinitionInput[] {
  return listBuiltinWorkflowCatalog().map(({ definitionPath, workflow }) => ({
    ...workflow,
    definitionPath,
  }));
}

export function getBuiltinAgents(): readonly AgentDef[] {
  return BUILTIN_AUTONOMY_AGENTS;
}
