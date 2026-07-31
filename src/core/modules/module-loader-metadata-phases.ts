import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertNoUnsupportedSkillToolPolicyFrontmatter } from "#core/agents/skill-tool-policy.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";
import type { LoadPhasePolicy } from "./module-loader-load-phases.js";
import type { LoaderState } from "./module-loader-state.js";
import { moduleToolSnapshots } from "./module-loader-tool-snapshots.js";
import {
  buildModuleCapabilityManifestProjection,
  buildModuleManifestEventFlows,
  buildModuleManifestSetupStatusLinks,
  registerModuleCapabilityManifestProjection,
} from "./module-manifest.js";
import {
  type KotaModule,
  type ModuleRuntimeContext,
  resolveModuleAgents,
  resolveModuleEffects,
  resolveModuleSetupRequirements,
  resolveModuleSkills,
  type ToolDef,
} from "./module-types.js";
import { validateModuleSetupRequirements } from "./setup-requirements.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

const KOTA_INSTALL_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function attachModuleSkills(
  state: LoaderState,
  policy: LoadPhasePolicy,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): Promise<void> {
  const skills = await resolveModuleSkills(mod, ctx);
  if (skills.length === 0) return;
  state.moduleSkillDefs.set(mod.name, skills);
  for (const skill of skills) {
    let raw: string;
    try {
      raw = readFileSync(resolveModuleSkillPromptPath(policy, skill.promptPath), "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(
        `[kota] Module "${mod.name}" skill "${skill.name}" failed to load: ${msg}`,
        "error",
      );
      continue;
    }
    assertNoUnsupportedSkillToolPolicyFrontmatter(raw, skill.promptPath);
    const content = raw.trim();
    if (!content) continue;
    state.skillContentsByName.set(skill.name, `### ${skill.name}\n${content}`);
    state.skillDefsByName.set(skill.name, skill);
  }
}

function resolveModuleSkillPromptPath(policy: LoadPhasePolicy, promptPath: string): string {
  const projectPath = resolve(policy.cwd, promptPath);
  if (existsSync(projectPath)) return projectPath;
  if (!promptPath.startsWith("src/")) return projectPath;
  const installPath = resolve(KOTA_INSTALL_ROOT, promptPath);
  return existsSync(installPath) ? installPath : projectPath;
}

async function attachModuleAgents(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): Promise<void> {
  const agents = await resolveModuleAgents(mod, ctx);
  if (agents.length > 0) state.moduleAgentDefs.set(mod.name, agents);
}

async function attachModuleSetupRequirements(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
): Promise<void> {
  const requirements = await resolveModuleSetupRequirements(mod, ctx);
  if (requirements.length === 0) return;
  validateModuleSetupRequirements(mod.name, requirements);
  state.moduleSetupRequirementDefs.set(
    mod.name,
    requirements.map((requirement) => ({ moduleName: mod.name, requirement })),
  );
}

function workflowTriggerLabels(
  workflows: readonly RegisteredWorkflowDefinitionInput[],
): string[] {
  const labels: string[] = [];
  for (const workflow of workflows) {
    for (const trigger of workflow.triggers) {
      if (trigger.event) labels.push(`event:${trigger.event}`);
      if (trigger.schedule) labels.push(`cron:${trigger.schedule}`);
      if (trigger.intervalMs !== undefined) labels.push(`interval:${trigger.intervalMs}`);
      if (trigger.webhook) labels.push("webhook");
      if (trigger.watch) {
        const patterns = Array.isArray(trigger.watch) ? trigger.watch : [trigger.watch];
        labels.push(`watch:${patterns.join(",")}`);
      }
    }
  }
  return labels;
}

function attachModuleManifest(
  state: LoaderState,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
  tools: readonly ToolDef[],
  effects: Awaited<ReturnType<typeof resolveModuleEffects>>,
): void {
  const setupRequirements = (state.moduleSetupRequirementDefs.get(mod.name) ?? [])
    .map(({ requirement }) => ({
      id: requirement.id,
      kind: requirement.kind,
      setupMode: requirement.setup.mode,
      sensitivity: requirement.sensitivity,
      required: requirement.required,
      healthCapabilityIds: requirement.health?.capabilityIds ?? [],
      statusLinks: buildModuleManifestSetupStatusLinks({
        moduleName: mod.name,
        requirementId: requirement.id,
        kind: requirement.kind,
        setupMode: requirement.setup.mode,
      }),
    }));
  const workflows = state.moduleWorkflowDefs.get(mod.name) ?? [];
  const manifestInput = typeof mod.manifest === "function" ? mod.manifest(ctx) : mod.manifest;
  const projection = buildModuleCapabilityManifestProjection(mod.name, manifestInput, {
    dependencies: mod.dependencies ?? [],
    tools: moduleToolSnapshots(tools),
    effects,
    workflows: workflows.map((workflow) => workflow.name),
    workflowTriggers: workflowTriggerLabels(workflows),
    channels: (state.moduleChannelDefs.get(mod.name) ?? []).map((channel) => channel.name),
    skills: (state.moduleSkillDefs.get(mod.name) ?? []).map((skill) => skill.name),
    agents: (state.moduleAgentDefs.get(mod.name) ?? []).map((agent) => agent.name),
    commands: (state.moduleCommands.get(mod.name) ?? []).map((command) => command.name()),
    routes: (state.moduleRoutes.get(mod.name) ?? []).map((route) => `${route.method} ${route.path}`),
    controlRoutes: (state.moduleControlRoutes.get(mod.name) ?? []).map((route) => `${route.method} ${route.path}`),
    events: (mod.events ?? []).map((event) => event.name),
    eventFlows: buildModuleManifestEventFlows({
      declaredEventNames: (mod.events ?? []).map((event) => event.name),
      workflows,
    }),
    localClientNamespaces: state.moduleLocalClientNamespaces.get(mod.name) ?? [],
    hasDaemonClientFactory: mod.daemonClient !== undefined,
    setupRequirements,
    hasHealthCheck: mod.healthCheck !== undefined,
  });
  state.moduleManifests.set(mod.name, projection);
  registerModuleCapabilityManifestProjection(projection);
}

export async function attachModuleMetadata(
  state: LoaderState,
  policy: LoadPhasePolicy,
  mod: KotaModule,
  ctx: ModuleRuntimeContext,
  tools: readonly ToolDef[],
): Promise<void> {
  await attachModuleSkills(state, policy, mod, ctx);
  await attachModuleAgents(state, mod, ctx);
  await attachModuleSetupRequirements(state, mod, ctx);
  attachModuleManifest(state, mod, ctx, tools, await resolveModuleEffects(mod, ctx));
}
