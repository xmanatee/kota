import type { SkillDef } from "#core/agents/agent-types.js";
import { getModuleToolNames } from "#core/tools/index.js";
import type { LoaderState } from "./module-loader-state.js";
import type { ModuleSummary } from "./module-types.js";

export function collectModuleSummaries(state: LoaderState): ModuleSummary[] {
  const loaded = state.modules.map((mod) => {
    const commandNames: string[] = [];
    const cachedCommands = state.moduleCommands.get(mod.name);
    if (cachedCommands) {
      for (const cmd of cachedCommands) commandNames.push(cmd.name());
    }
    const commandError = state.moduleCommandErrors.get(mod.name);
    const routeSummaries: string[] = [];
    const cachedRoutes = state.moduleRoutes.get(mod.name);
    if (cachedRoutes) {
      for (const r of cachedRoutes) routeSummaries.push(`${r.method} ${r.path}`);
    }
    const routeError = state.moduleRouteErrors.get(mod.name);
    return {
      name: mod.name,
      source: state.moduleSources.get(mod.name) ?? "project",
      version: mod.version,
      description: mod.description,
      dependencies: mod.dependencies ?? [],
      toolNames: getModuleToolNames(mod.name),
      workflowNames: (state.moduleWorkflowDefs.get(mod.name) ?? []).map((w) => w.name),
      channelNames: (state.moduleChannelDefs.get(mod.name) ?? []).map((c) => c.name),
      skillNames: (state.moduleSkillDefs.get(mod.name) ?? []).map((s) => s.name),
      agentNames: (state.moduleAgentDefs.get(mod.name) ?? []).map((a) => a.name),
      agents: [...(state.moduleAgentDefs.get(mod.name) ?? [])],
      skills: [...(state.moduleSkillDefs.get(mod.name) ?? [])],
      commandNames,
      routeSummaries,
      ...(commandError ? { commandError } : {}),
      ...(routeError ? { routeError } : {}),
      health: mod.getHealth?.(),
    };
  });
  const failed: ModuleSummary[] = [];
  for (const [name, failure] of state.loadFailures) {
    failed.push({
      name,
      source: state.moduleSources.get(name) ?? "project",
      dependencies: [],
      toolNames: [],
      workflowNames: [],
      channelNames: [],
      skillNames: [],
      agentNames: [],
      agents: [],
      skills: [],
      commandNames: [],
      routeSummaries: [],
      loadError: failure.message.slice(0, 500),
    });
  }
  return [...loaded, ...failed];
}

export function formatSkillsPrompt(
  skillContentsByName: ReadonlyMap<string, string>,
  skillDefsByName: ReadonlyMap<string, SkillDef>,
  explicitOnlySkillNames: ReadonlySet<string>,
  skillNames: string[] | "all",
  agentName?: string,
): string {
  if (skillContentsByName.size === 0) return "";
  const names = skillNames === "all"
    ? [...skillContentsByName.keys()].filter((name) => !explicitOnlySkillNames.has(name))
    : skillNames;
  const entries = names
    .filter((name) => {
      const def = skillDefsByName.get(name);
      if (!def) return skillNames !== "all";
      if (!def.roles || def.roles.length === 0) return true;
      return agentName !== undefined && def.roles.includes(agentName);
    })
    .map((name) => skillContentsByName.get(name))
    .filter((c): c is string => c !== undefined);
  if (entries.length === 0) return "";
  return `\n\n## Module Capabilities\n${entries.join("\n\n")}`;
}
