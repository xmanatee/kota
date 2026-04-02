/**
 * Guardrails risk classification — tool lists and input pattern analysis.
 *
 * Determines the risk level of a tool call based on the tool name and its
 * input. Consumed by guardrails.ts for policy resolution.
 */

import { getCoreRegistrations } from "./tools/index.js";

export type RiskLevel = "safe" | "moderate" | "dangerous";

// ─── Tool classification ──────────────────────────────────────────────
// Core tool risk levels are derived from the tool registry.
// Module-registered tools (not in coreRegistrations) are listed manually.
// Lazy to avoid issues when tests mock tools/index.js.

let _safeTools: Set<string> | null = null;
let _moderateTools: Set<string> | null = null;

/** Tools that only read data or coordinate — never mutate state. */
export function safeTools(): Set<string> {
  if (!_safeTools) {
    _safeTools = new Set([
      ...getCoreRegistrations().filter((r) => r.risk === "safe").map((r) => r.tool.name),
      "enable_tools",
      // Module-registered tools
      "memory",
      "conversation_recall",
      "get_secret",
      // GitHub read-only tools
      "github_get_pr",
      "github_list_issues",
      "github_list_prs",
    ]);
  }
  return _safeTools;
}

/** Tools that mutate local state in controlled ways. */
export function moderateTools(): Set<string> {
  if (!_moderateTools) {
    _moderateTools = new Set([
      ...getCoreRegistrations().filter((r) => r.risk === "moderate").map((r) => r.tool.name),
      // Module-registered tools
      "schedule",
    ]);
  }
  return _moderateTools;
}

/** Patterns in shell/process commands that indicate destructive operations. */
export const DANGEROUS_COMMAND_PATTERNS = [
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
export const DANGEROUS_CODE_PATTERNS = [
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
export const MUTATION_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

// ─── Risk classification ──────────────────────────────────────────────

export function extractCommand(input: Record<string, unknown>): string {
  return ((input.command as string) || "").trim();
}

export function isDangerousCommand(command: string): boolean {
  return DANGEROUS_COMMAND_PATTERNS.some((p) => p.test(command));
}

export function isDangerousCode(code: string): boolean {
  return DANGEROUS_CODE_PATTERNS.some((p) => p.test(code));
}

export function isOutsideProject(filePath: string): boolean {
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
  if (safeTools().has(name)) {
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
  if (moderateTools().has(name)) {
    return { risk: "moderate", reason: `${name} modifies state` };
  }

  // GitHub mutating tools — always dangerous (require approval in autonomous mode)
  if (name === "github_create_pr" || name === "github_comment" || name === "github_merge_pr" || name === "github_close_pr") {
    return { risk: "dangerous", reason: "GitHub mutation tool" };
  }

  // Unknown tools (MCP, extension-registered) default to moderate.
  return { risk: "moderate", reason: "unclassified tool" };
}
