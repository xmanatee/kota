/**
 * Guardrails — centralized risk classification and policy enforcement for all tool calls.
 *
 * Every tool call is assessed for risk before execution. The policy determines
 * whether to allow, require confirmation, or deny the call. Configurable via
 * .kota/config.json. Non-interactive contexts (server, telegram, daemon) use
 * stricter defaults.
 */

export type RiskLevel = "safe" | "moderate" | "dangerous";
export type Policy = "allow" | "confirm" | "deny";

export type GuardrailsConfig = {
  /** Policy applied at each risk level. */
  policies: Record<RiskLevel, Policy>;
  /** Override policy for specific tool names (bypasses risk classification). */
  toolOverrides?: Record<string, Policy>;
};

export type Assessment = {
  tool: string;
  risk: RiskLevel;
  policy: Policy;
  reason: string;
};

// ─── Default configuration ────────────────────────────────────────────

const DEFAULT_POLICIES: Record<RiskLevel, Policy> = {
  safe: "allow",
  moderate: "allow",
  dangerous: "confirm",
};

const DEFAULT_CONFIG: GuardrailsConfig = {
  policies: { ...DEFAULT_POLICIES },
};

// ─── Tool classification ──────────────────────────────────────────────

/** Tools that only read data or coordinate — never mutate state. */
const SAFE_TOOLS = new Set([
  "file_read",
  "grep",
  "glob",
  "repo_map",
  "todo",
  "ask_user",
  "enable_tools",
  "files_overview",
  "memory",
  "conversation_recall",
  "web_search",
  "get_secret",
  "notify",
  "screenshot",
]);

/** Tools that mutate local state in controlled ways. */
const MODERATE_TOOLS = new Set([
  "file_edit",
  "file_write",
  "multi_edit",
  "find_replace",
  "code_exec",
  "notebook",
  "web_fetch",
  "delegate",
  "schedule",
  "custom_tool",
  "module_factory",
]);

/** Patterns in shell/process commands that indicate destructive operations. */
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s/,
  /\bgit\s+push\b/,
  /\bgit\s+reset\b/,
  /\bgit\s+clean\b/,
  /\bgit\s+checkout\s+\./,
  /\bdocker\s+rm\b/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s/,
  /\bkill\b/,
  /\bchmod\b.*777/,
  /\b(npm|pnpm|yarn)\s+publish\b/,
  />\s*\/dev\/sd/,
  /\bcurl\b.*-X\s*(DELETE|PUT|POST|PATCH)\b/,
  /\bwget\b.*--post/,
];

/** Patterns in code_exec that indicate system-level operations. */
const DANGEROUS_CODE_PATTERNS = [
  /\bos\.system\b/,
  /\bsubprocess\b/,
  /\bchild_process\b/,
  /\bexecSync\b/,
  /\bspawnSync\b/,
  /\bshutil\.rmtree\b/,
  /\bfs\.rmSync\b/,
  /\bfs\.unlinkSync\b/,
];

/** HTTP methods that mutate remote state. */
const MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// ─── Risk classification ──────────────────────────────────────────────

function extractCommand(input: Record<string, unknown>): string {
  return ((input.command as string) || "").trim();
}

function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((p) => p.test(command));
}

function isDangerousCode(code: string): boolean {
  return DANGEROUS_CODE_PATTERNS.some((p) => p.test(code));
}

function isOutsideProject(filePath: string): boolean {
  const cwd = process.cwd();
  const resolved = filePath.startsWith("/") ? filePath : `${cwd}/${filePath}`;
  // Normalize: remove trailing slashes, resolve ..
  const normalizedCwd = cwd.replace(/\/+$/, "");
  return !resolved.startsWith(normalizedCwd);
}

/** Classify a tool call's risk level based on the tool name and its input. */
export function classifyRisk(
  name: string,
  input: Record<string, unknown>,
): { risk: RiskLevel; reason: string } {
  // Explicit safe tools
  if (SAFE_TOOLS.has(name)) {
    return { risk: "safe", reason: "read-only tool" };
  }

  // Shell and process: check command content
  if (name === "shell" || name === "process") {
    const command = extractCommand(input);
    if (isDangerousCommand(command)) {
      return { risk: "dangerous", reason: `destructive command pattern detected` };
    }
    return { risk: "moderate", reason: "shell execution" };
  }

  // File operations: check if writing outside project
  if (name === "file_write" || name === "file_edit" || name === "multi_edit" || name === "find_replace") {
    const path = (input.path || input.file_path || input.file) as string;
    if (path && isOutsideProject(path)) {
      return { risk: "dangerous", reason: `file operation outside project directory` };
    }
    if (name === "multi_edit" && Array.isArray(input.edits)) {
      for (const edit of input.edits as { file?: string }[]) {
        if (edit.file && isOutsideProject(edit.file)) {
          return { risk: "dangerous", reason: `multi_edit targets file outside project directory` };
        }
      }
    }
    return { risk: "moderate", reason: "file modification" };
  }

  // Code execution: check for system-level operations
  if (name === "code_exec") {
    const code = (input.code as string) || "";
    if (isDangerousCode(code)) {
      return { risk: "dangerous", reason: `code contains system-level operation` };
    }
    return { risk: "moderate", reason: "code execution" };
  }

  // HTTP: mutation methods are moderate, not dangerous (the agent often needs POST)
  if (name === "http_request") {
    const method = ((input.method as string) || "GET").toUpperCase();
    if (MUTATION_METHODS.has(method)) {
      return { risk: "moderate", reason: `HTTP ${method} request` };
    }
    return { risk: "safe", reason: "HTTP GET request" };
  }

  // Known moderate tools
  if (MODERATE_TOOLS.has(name)) {
    return { risk: "moderate", reason: `${name} modifies state` };
  }

  // Unknown tools (MCP, module-registered) — default to moderate
  return { risk: "moderate", reason: "unclassified tool" };
}

// ─── Policy resolution ────────────────────────────────────────────────

/** Determine the policy for a tool call given config and risk assessment. */
export function resolvePolicy(
  name: string,
  risk: RiskLevel,
  config: GuardrailsConfig,
): Policy {
  // Tool-level override takes precedence
  if (config.toolOverrides?.[name]) {
    return config.toolOverrides[name];
  }
  return config.policies[risk] ?? DEFAULT_POLICIES[risk];
}

// ─── Assessment (public API) ──────────────────────────────────────────

/** Assess a tool call: classify risk and resolve policy. */
export function assess(
  name: string,
  input: Record<string, unknown>,
  config?: GuardrailsConfig,
): Assessment {
  const effectiveConfig = config ?? DEFAULT_CONFIG;
  const { risk, reason } = classifyRisk(name, input);
  const policy = resolvePolicy(name, risk, effectiveConfig);
  return { tool: name, risk, policy, reason };
}

// ─── Stricter defaults for non-interactive contexts ───────────────────

/** Policies for autonomous/non-interactive contexts (server, telegram, daemon). */
export const NON_INTERACTIVE_POLICIES: Record<RiskLevel, Policy> = {
  safe: "allow",
  moderate: "allow",
  dangerous: "deny",
};

export function nonInteractiveConfig(
  base?: GuardrailsConfig,
): GuardrailsConfig {
  return {
    policies: { ...NON_INTERACTIVE_POLICIES },
    toolOverrides: base?.toolOverrides,
  };
}

// ─── Config helpers ───────────────────────────────────────────────────

export function getDefaultConfig(): GuardrailsConfig {
  return { ...DEFAULT_CONFIG, policies: { ...DEFAULT_POLICIES } };
}

/** Validate and sanitize a raw guardrails config object from JSON. */
export function sanitizeGuardrailsConfig(
  raw: Record<string, unknown>,
): GuardrailsConfig | null {
  if (typeof raw !== "object" || raw === null) return null;

  const config: GuardrailsConfig = { policies: { ...DEFAULT_POLICIES } };

  if (typeof raw.policies === "object" && raw.policies !== null) {
    const p = raw.policies as Record<string, unknown>;
    for (const level of ["safe", "moderate", "dangerous"] as RiskLevel[]) {
      const val = p[level];
      if (val === "allow" || val === "confirm" || val === "deny") {
        config.policies[level] = val;
      }
    }
  }

  if (typeof raw.toolOverrides === "object" && raw.toolOverrides !== null) {
    const overrides: Record<string, Policy> = {};
    for (const [key, val] of Object.entries(raw.toolOverrides as Record<string, unknown>)) {
      if (val === "allow" || val === "confirm" || val === "deny") {
        overrides[key] = val;
      }
    }
    if (Object.keys(overrides).length > 0) {
      config.toolOverrides = overrides;
    }
  }

  return config;
}
