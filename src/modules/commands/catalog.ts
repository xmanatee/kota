/**
 * Slash-command catalog — derives user-facing commands from contributed
 * skills and trigger-able workflows. The catalog is the single source of
 * truth: clients fetch it through the daemon/web APIs; there is no parallel
 * per-command registration surface.
 */

import { readFileSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { SkillDef } from "#core/agents/agent-types.js";
import type { ModuleContext, ModuleSummary } from "#core/modules/module-types.js";
import type {
  SlashCommand,
  SlashCommandAction,
  SlashCommandCatalog,
} from "#core/modules/slash-command-provider.js";
import type { RegisteredWorkflowDefinitionInput } from "#core/workflow/types.js";

export type {
  SlashCommand,
  SlashCommandAction,
  SlashCommandCatalog,
  SlashCommandSource,
} from "#core/modules/slash-command-provider.js";
export { SLASH_COMMAND_PROVIDER_TYPE } from "#core/modules/slash-command-provider.js";

/**
 * A workflow opts into the slash-command catalog by tagging itself with this
 * value. Untagged workflows remain triggerable through the normal API but do
 * not appear in the user-facing palette, so internal automation stays out of
 * operator sight.
 */
export const COMMAND_WORKFLOW_TAG = "command";

/** Prefix used for skill-backed commands. */
export const SKILL_COMMAND_PREFIX = "skill:";

function isCommandWorkflow(def: RegisteredWorkflowDefinitionInput): boolean {
  return Array.isArray(def.tags) && def.tags.includes(COMMAND_WORKFLOW_TAG);
}

function skillCommandName(skill: SkillDef): string {
  return `${SKILL_COMMAND_PREFIX}${skill.name}`;
}

function findSkill(
  summaries: readonly ModuleSummary[],
  skillName: string,
): { summary: ModuleSummary; skill: SkillDef } | null {
  for (const summary of summaries) {
    for (const skill of summary.skills) {
      if (skill.name === skillName) return { summary, skill };
    }
  }
  return null;
}

function readSkillPrompt(skill: SkillDef, projectDir: string): string {
  const path = isAbsolute(skill.promptPath)
    ? skill.promptPath
    : resolvePath(projectDir, skill.promptPath);
  return readFileSync(path, "utf8").trim();
}

export type CatalogDeps = {
  getContributedWorkflows: () => readonly RegisteredWorkflowDefinitionInput[];
  getModuleSummaries: () => readonly ModuleSummary[];
  projectDir: string;
};

export function buildSlashCommandCatalog(deps: CatalogDeps): SlashCommandCatalog {
  return {
    list(): SlashCommand[] {
      const commands: SlashCommand[] = [];
      for (const def of deps.getContributedWorkflows()) {
        if (!isCommandWorkflow(def)) continue;
        commands.push({
          name: def.name,
          label: `/${def.name}`,
          description: def.description,
          source: "workflow",
          module: def.contributingModule ?? "workflow",
        });
      }
      const seen = new Set(commands.map((c) => c.name));
      for (const summary of deps.getModuleSummaries()) {
        for (const skill of summary.skills) {
          const name = skillCommandName(skill);
          if (seen.has(name)) continue;
          seen.add(name);
          commands.push({
            name,
            label: `/${name}`,
            description: skill.description,
            source: "skill",
            module: summary.name,
          });
        }
      }
      commands.sort((a, b) => a.name.localeCompare(b.name));
      return commands;
    },

    resolve(name: string): SlashCommandAction | null {
      if (name.startsWith(SKILL_COMMAND_PREFIX)) {
        const skillName = name.slice(SKILL_COMMAND_PREFIX.length);
        const found = findSkill(deps.getModuleSummaries(), skillName);
        if (!found) return null;
        const prompt = readSkillPrompt(found.skill, deps.projectDir);
        if (!prompt) return null;
        return { kind: "skill", prompt };
      }
      for (const def of deps.getContributedWorkflows()) {
        if (def.name !== name) continue;
        if (!isCommandWorkflow(def)) return null;
        return { kind: "workflow", workflow: name };
      }
      return null;
    },
  };
}

/** Convenience: build a catalog from a module context. */
export function catalogFromModuleContext(ctx: ModuleContext): SlashCommandCatalog {
  return buildSlashCommandCatalog({
    getContributedWorkflows: () => ctx.getContributedWorkflows(),
    getModuleSummaries: () => ctx.getModuleSummaries(),
    projectDir: ctx.cwd,
  });
}
