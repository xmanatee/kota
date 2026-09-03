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
 * Adapter-private per-run options (e.g. claude-agent-sdk's permission and
 * setting fields, future Codex CLI flags) live on the step's
 * `harnessOptions[<harness>]` carve-out in `#core/workflow/types.js` and
 * are only interpreted by the matching harness adapter. They are not a
 * property of the agent itself — an agent may run on any registered
 * harness.
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
  /** Path to the markdown file containing this skill's guidance (relative to scope root). */
  promptPath: string;
  /** Agent names this skill is scoped to. Omit for universal availability. */
  roles?: string[];
};

/** Tool access policy for an agent. */
export type AgentToolPolicy = {
  allowed?: string[];
  disallowed?: string[];
};

/** Workspace mutation boundary enforced during and after an agent run. */
export type AgentWriteScope = readonly string[] | "deny-all";

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
  /** Path to this agent's main instruction file (relative to scope root). */
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
   * Paths this agent may mutate, relative to its workflow workspace.
   * Each
   * entry is a path prefix (directory) or an exact file path. A trailing
   * slash is optional — `"data/tasks/"` and `"data/tasks"` both match any
   * path under `data/tasks/`.
   *
   * An empty array is the explicit "unrestricted" opt-in: every tracked-file
   * mutation is allowed. `"deny-all"` is the distinct read-only declaration:
   * every attempted tracked-file mutation fails and is restored. Required on
   * every agent because absence must not silently mean unrestricted; the
   * Direct-filesystem harnesses project this into their machine sandbox and
   * KOTA-hosted tools enforce it before execution. Workflow agents separately
   * receive one runtime-owned per-run output directory for evidence and finish
   * artifacts; that exception never exposes sibling workflow state. The
   * workflow runtime also checks the resulting repo mutation set after the
   * agent step.
   */
  writeScope: AgentWriteScope;
};

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  for (const entry of value) assertNonEmptyString(entry, `${label} entry`);
}

function assertKnownFields(
  value: Record<string, unknown>,
  fields: ReadonlySet<string>,
  label: string,
): void {
  for (const key of Object.keys(value)) {
    if (!fields.has(key)) throw new Error(`${label} has unknown field "${key}"`);
  }
}

const AGENT_FIELDS = new Set<keyof AgentDef>([
  "name",
  "role",
  "promptPath",
  "model",
  "effort",
  "skills",
  "tools",
  "writeScope",
]);

const AGENT_TOOL_POLICY_FIELDS = new Set<keyof AgentToolPolicy>(["allowed", "disallowed"]);
const SKILL_FIELDS = new Set<keyof SkillDef>([
  "name",
  "description",
  "promptPath",
  "roles",
]);

/** Runtime decoder for module-contributed skill declarations. */
export function assertSkillDefinitions(
  moduleName: string,
  values: readonly unknown[],
): asserts values is readonly SkillDef[] {
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" skill[${index}]`;
    assertRecord(value, label);
    assertKnownFields(value, SKILL_FIELDS, label);
    assertNonEmptyString(value.name, `${label}.name`);
    assertNonEmptyString(value.promptPath, `${label}.promptPath`);
    if (value.description !== undefined) {
      assertNonEmptyString(value.description, `${label}.description`);
    }
    if (value.roles !== undefined) assertStringArray(value.roles, `${label}.roles`);
  }
}

/** Runtime decoder for module-contributed agent declarations. */
export function assertAgentDefinitions(
  moduleName: string,
  values: readonly unknown[],
): asserts values is readonly AgentDef[] {
  const efforts = new Set(["low", "medium", "high", "xhigh", "max"]);
  for (const [index, value] of values.entries()) {
    const label = `Module "${moduleName}" agent[${index}]`;
    assertRecord(value, label);
    assertKnownFields(value, AGENT_FIELDS, label);
    assertNonEmptyString(value.name, `${label}.name`);
    assertNonEmptyString(value.role, `${label}.role`);
    assertNonEmptyString(value.promptPath, `${label}.promptPath`);
    assertNonEmptyString(value.model, `${label}.model`);
    if (typeof value.effort !== "string" || !efforts.has(value.effort)) {
      throw new Error(`${label}.effort must be low, medium, high, xhigh, or max`);
    }
    if (value.skills !== undefined && value.skills !== "all") {
      assertStringArray(value.skills, `${label}.skills`);
    }
    if (value.writeScope !== "deny-all") {
      assertStringArray(value.writeScope, `${label}.writeScope`);
    }
    if (value.tools !== undefined) {
      assertRecord(value.tools, `${label}.tools`);
      assertKnownFields(value.tools, AGENT_TOOL_POLICY_FIELDS, `${label}.tools`);
      if (value.tools.allowed !== undefined) {
        assertStringArray(value.tools.allowed, `${label}.tools.allowed`);
      }
      if (value.tools.disallowed !== undefined) {
        assertStringArray(value.tools.disallowed, `${label}.tools.disallowed`);
      }
    }
  }
}
