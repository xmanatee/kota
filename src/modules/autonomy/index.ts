import { fileURLToPath } from "node:url";
import type { AgentDef } from "#core/agents/agent-types.js";
import { SCOPE_DRAIN_INSPECTION_PROVIDER_TYPE } from "#core/daemon/scope-drain-inspection.js";
import type { KotaModule, ModuleRuntimeContext } from "#core/modules/module-types.js";
import {
  importModuleExports,
  listModuleDirectories,
} from "#core/modules/runtime-module-discovery.js";
import type { RegisteredWorkflowDefinitionInput, WorkflowDefinitionInput } from "#core/workflow/types.js";
import { reconcileAutomationWorktrees } from "#modules/git/worktree-lifecycle.js";
import { WORKFLOW_STATE_RECOVERY_PROVIDER_TYPE } from "#modules/workflow-ops/state-recovery-provider.js";
import { autonomyHealthSignal } from "./health-signal.js";
import { buildLoopQualityAuditCommand } from "./loop-quality-audit-cli.js";
import { buildReportCommand } from "./report/report-cli.js";
import { autonomyScopeDrainInspection } from "./scope-drain-inspection.js";
import { createWorkflowStateRecoveryProvider } from "./workflow-state-recovery.js";
import { autonomyWorkflowConcurrencyGroupFor } from "./workflow-workspace-policy.js";
import { buildAttentionCommand } from "./workflows/attention-digest/attention-cli.js";
import { attentionRoutes } from "./workflows/attention-digest/attention-route.js";
import { buildDigestCommand } from "./workflows/daily-digest/digest-cli.js";
import { digestRoutes } from "./workflows/daily-digest/digest-route.js";
import { dailyDigestUiSurfaceSource } from "./workflows/daily-digest/ui-surface.js";
import { progressReviewRequested } from "./workflows/progress-reviewer/events.js";
import {
  scopeImprovementEvidenceReady,
  scopeImprovementRequested,
} from "./workflows/scope-improver/events.js";

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
  return modules.map(({ name, workflow }) => {
    const concurrencyGroup = autonomyWorkflowConcurrencyGroupFor(name);
    if (
      concurrencyGroup !== undefined &&
      workflow.concurrencyGroup !== undefined &&
      workflow.concurrencyGroup !== concurrencyGroup
    ) {
      throw new Error(
        `Autonomy workflow "${name}" concurrencyGroup must match its workspace policy`,
      );
    }
    return {
      ...workflow,
      ...(concurrencyGroup !== undefined ? { concurrencyGroup } : {}),
      definitionPath: `src/modules/autonomy/workflows/${name}/workflow.ts`,
      moduleRoot: KOTA_INSTALL_ROOT,
    };
  });
}

async function discoverAutonomyAgents(): Promise<AgentDef[]> {
  const modules = await discoverAutonomyWorkflowModules();
  return modules
    .map(({ agent }) => agent)
    .filter((agent): agent is AgentDef => agent !== undefined);
}

function reconcileBuilderWorktreesFromRuntime(
  ctx: ModuleRuntimeContext,
  source: string,
): void {
  try {
    const result = reconcileAutomationWorktrees(ctx.cwd);
    if (result.inspected === 0) return;
    ctx.log.info(
      `Automation worktree reconciliation after ${source}: inspected=${result.inspected} ` +
        `active=${result.active} unlocked=${result.unlocked} removed=${result.removed} ` +
        `preserved=${result.preserved}`,
    );
  } catch (error) {
    ctx.log.warn(
      `Automation worktree reconciliation after ${source} failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

const autonomyModule: KotaModule = {
  name: "autonomy",
  version: "1.0.0",
  description: "Autonomous development workflows and their paired agents",
  dependencies: [
    "workflow-ops",
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
    scopeImprovementRequested,
    scopeImprovementEvidenceReady,
    autonomyHealthSignal,
  ],
  workflows: async () => await discoverAutonomyWorkflowDefinitions(),
  agents: async () => await discoverAutonomyAgents(),
  uiSurfaces: [dailyDigestUiSurfaceSource],
  onLoad: (ctx) => {
    ctx.registerProvider(
      SCOPE_DRAIN_INSPECTION_PROVIDER_TYPE,
      autonomyScopeDrainInspection,
    );
    ctx.registerProvider(
      WORKFLOW_STATE_RECOVERY_PROVIDER_TYPE,
      createWorkflowStateRecoveryProvider(),
    );
    ctx.events.subscribe("workflow.interrupted.alert", (payload) => {
      if (payload.workflow !== "builder") return;
      reconcileBuilderWorktreesFromRuntime(ctx, `workflow.interrupted.alert ${payload.runId}`);
    });
  },
  commands: () => [
    buildDigestCommand(),
    buildAttentionCommand(),
    buildReportCommand(),
    buildLoopQualityAuditCommand(discoverAutonomyWorkflowDefinitions),
  ],
  routes: (ctx) => [
    ...digestRoutes({ projectDir: ctx.cwd }),
    ...attentionRoutes({ projectDir: ctx.cwd }),
  ],
};

export default autonomyModule;
