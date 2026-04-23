/**
 * Skill and agent definition types — first-class runtime concepts in KOTA.
 *
 * A `SkillDef` is the one reusable guidance concept: named, file-backed,
 * and composable across agents.
 *
 * An `AgentDef` is a named autonomous worker with a declared role, model
 * defaults, skill set, and tool policy. Built-in and module-contributed
 * agents use the same model rather than ad hoc prompt conventions scattered
 * across workflow files.
 *
 * Claude-agent-sdk-specific per-run options (permissionMode, settingSources)
 * live on the step's `claudeAgentSdk` carve-out in `#core/workflow/types.js`
 * and are only interpreted by the claude-agent-sdk harness. They are not a
 * property of the agent itself — an agent may run on any registered harness.
 */

/**
 * A named, file-backed piece of reusable agent guidance.
 *
 * Skills are the single concept for reusable instructions. Repo AGENTS.md
 * files, workflow prompt files, and module capability docs are all skills.
 * Modules contribute skills; agents declare which skills they use.
 */
export type SkillDef = {
  /** Unique identifier for this skill (e.g. "repo-instructions", "builder-guidance"). */
  name: string;
  /** Short description of what this skill teaches. */
  description?: string;
  /** Path to the markdown file containing this skill's guidance (relative to project root). */
  promptPath: string;
  /** Agent names this skill is scoped to. Omit for universal availability. */
  roles?: string[];
};

/** Tool access policy for an agent. */
export type AgentToolPolicy = {
  allowed?: string[];
  disallowed?: string[];
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
  /** Model to use when running this agent. */
  model: string;
  /** How hard the model should think. Required — every agent declares its effort level explicitly. */
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  /** Names of skills this agent uses. Use "all" to receive every registered skill. */
  skills?: string[] | "all";
  /** Tool access policy. */
  tools?: AgentToolPolicy;
  /**
   * Tracked-file paths this agent may mutate, relative to `projectDir`. Each
   * entry is a path prefix (directory) or an exact file path. A trailing
   * slash is optional — `"data/tasks/"` and `"data/tasks"` both match any
   * path under `data/tasks/`.
   *
   * An empty array is the explicit "unrestricted" opt-in: every tracked-file
   * mutation is allowed. Required on every agent because absence must not
   * silently mean unrestricted; the workflow runtime enforces this at the
   * end of an agent step.
   */
  writeScope: string[];
};
