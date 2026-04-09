/**
 * Skill and agent definition types — first-class runtime concepts in KOTA.
 *
 * A `SkillDef` is the one reusable guidance concept: named, file-backed,
 * and composable across agents.
 *
 * An `AgentDef` is a named autonomous worker with a declared role, model
 * defaults, skill set, and tool policy. Built-in and extension-contributed
 * agents use the same model rather than ad hoc prompt conventions scattered
 * across workflow files.
 */

import type { SDKPermissionMode, SDKSettingSource } from "./agent-sdk/types.js";

/**
 * A named, file-backed piece of reusable agent guidance.
 *
 * Skills are the single concept for reusable instructions. Repo AGENTS.md
 * files, workflow prompt files, and extension capability docs are all skills.
 * Extensions contribute skills; agents declare which skills they use.
 */
export type SkillDef = {
  /** Unique identifier for this skill (e.g. "repo-instructions", "builder-guidance"). */
  name: string;
  /** Short description of what this skill teaches. */
  description?: string;
  /** Path to the markdown file containing this skill's guidance (relative to project root). */
  promptPath: string;
};

/** Tool access policy for an agent. */
export type AgentToolPolicy = {
  allowed?: string[];
  disallowed?: string[];
  permissionMode?: SDKPermissionMode;
};

/**
 * A named autonomous worker.
 *
 * AgentDef is the single model for declaring a specialist role. Workflows
 * reference agents by name; the definition supplies the prompt path, model,
 * skills, and tool policy so those details live in one place rather than
 * spread across workflow step configurations.
 */
export type AgentDef = {
  /** Unique identifier for this agent. */
  name: string;
  /** Short description of this agent's role and purpose. */
  role: string;
  /** Path to this agent's main instruction file (relative to project root). */
  promptPath: string;
  /** Default model to use when running this agent. */
  model?: string;
  /** Names of skills this agent uses. */
  skills?: string[];
  /** Tool access policy. */
  tools?: AgentToolPolicy;
  /** Directories this agent may write to (relative to project root). Empty = unrestricted. */
  writeScope?: string[];
  /** Claude Code settings sources to apply when running. */
  settingSources?: SDKSettingSource[];
};
