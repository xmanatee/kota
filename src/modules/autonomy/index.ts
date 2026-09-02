import type { AgentDef } from "#core/agents/agent-types.js";
import type { KotaModule } from "#core/modules/module-types.js";
import {
  importModuleExports,
  listModuleDirectories,
} from "#core/modules/runtime-module-discovery.js";
import { kotaRuntimeAssetRoot } from "#core/util/kota-install-paths.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested } from "./autonomy-issue-events.js";
import { subscribeAutonomyIssueSources } from "./autonomy-issue-sources.js";
import { autonomyHealthSignal } from "./health-signal.js";
import { buildReportCommand } from "./report/report-cli.js";
import { buildAttentionCommand } from "./workflows/attention-digest/attention-cli.js";
import { attentionRoutes } from "./workflows/attention-digest/attention-route.js";
import { buildDigestCommand } from "./workflows/daily-digest/digest-cli.js";
import { digestRoutes } from "./workflows/daily-digest/digest-route.js";
import { dailyDigestUiSurfaceSource } from "./workflows/daily-digest/ui-surface.js";
import {
  automaticProgressReviewRequested,
  progressReviewRequested,
} from "./workflows/progress-reviewer/events.js";
import {
  scopeImprovementChanged,
  scopeImprovementRequested,
} from "./workflows/scope-improver/events.js";

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
    moduleRoot: kotaRuntimeAssetRoot,
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
  dependencies: [
    "workflow-ops",
    "owner-questions",
    "repo-tasks",
    "rendering",
    "daemon-ops",
    "github-webhook",
    "github",
    "git",
    "inbound-signals",
    "repo-ai-checks",
  ],
  events: [
    progressReviewRequested,
    automaticProgressReviewRequested,
    scopeImprovementRequested,
    scopeImprovementChanged,
    autonomyHealthSignal,
    autonomyIssueDecisionRequested,
  ],
  workflows: async () => await discoverAutonomyWorkflowDefinitions(),
  agents: async () => await discoverAutonomyAgents(),
  uiSurfaces: [dailyDigestUiSurfaceSource],
  onLoad: (ctx) => {
    subscribeAutonomyIssueSources(ctx);
  },
  commands: (ctx) => [
    buildDigestCommand(),
    buildAttentionCommand(ctx),
    buildReportCommand(),
  ],
  routes: (ctx) => [
    ...digestRoutes({ workspaceRoot: ctx.cwd }),
    ...attentionRoutes({ workspaceRoot: ctx.cwd }),
  ],
};

export default autonomyModule;
