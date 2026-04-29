/**
 * Guardrails risk classification — derives policy-relevant risk from each
 * tool's declared effect plus a small set of input-pattern guards for
 * shell/file/code/HTTP shapes.
 *
 * Tools declare an effect at registration (see `./effect.ts`); this module
 * is the single boundary that:
 *   - asks the registry for a tool's effect and translates it into a risk
 *     tier for guardrail policy resolution,
 *   - escalates shell/process/code/file-write/HTTP calls when their input
 *     contains a destructive pattern,
 *   - exports MCP `tools/list` annotations derived from the same effect.
 *
 * Static name lists (NETWORK_TOOL_NAMES, DESTRUCTIVE_TOOL_NAMES, ...) used
 * to live here. They were a parallel source of truth and have been removed:
 * effects own that information now.
 */

import {
  type McpToolAnnotations,
  mcpAnnotationsFromEffect,
  type RiskTier,
  riskFromEffect,
} from "./effect.js";
import { getToolEffect } from "./index.js";

export type RiskLevel = RiskTier;
export type { McpToolAnnotations };

// ─── Input-pattern guards ─────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────

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
  const normalizedCwd = cwd.replace(/\/+$/, "");
  return !resolved.startsWith(normalizedCwd);
}

// ─── Classification ───────────────────────────────────────────────────

/**
 * Classify a tool call's risk level based on its declared effect and a small
 * set of input-pattern guards.
 *
 * Priority:
 *   1. If the tool declares an effect, derive the base tier from it.
 *   2. Escalate when the input matches a known-destructive pattern.
 *   3. Tools without a declared effect default to moderate ("unclassified").
 */
export function classifyRisk(
  name: string,
  input: Record<string, unknown>,
): { risk: RiskLevel; reason: string } {
  const effect = getToolEffect(name);
  const baseTier: RiskLevel | undefined = effect ? riskFromEffect(effect) : undefined;

  // Shell/process: escalate to dangerous when the command matches a
  // destructive pattern, regardless of the declared base effect.
  if (name === "shell" || name === "process") {
    const command = extractCommand(input);
    if (isDangerousCommand(command)) {
      return { risk: "dangerous", reason: "destructive command pattern detected" };
    }
    if (baseTier) return { risk: baseTier, reason: "shell execution" };
    return { risk: "moderate", reason: "shell execution" };
  }

  // File write/edit family: escalate when the path leaves the project root.
  if (
    name === "file_write" ||
    name === "file_edit" ||
    name === "multi_edit" ||
    name === "find_replace"
  ) {
    const path = (input.path || input.file_path || input.file) as string;
    if (path && isOutsideProject(path)) {
      return { risk: "dangerous", reason: "file operation outside project directory" };
    }
    if (name === "multi_edit" && Array.isArray(input.edits)) {
      for (const edit of input.edits as { file?: string }[]) {
        if (edit.file && isOutsideProject(edit.file)) {
          return { risk: "dangerous", reason: "multi_edit targets file outside project directory" };
        }
      }
    }
    if (baseTier) return { risk: baseTier, reason: "file modification" };
    return { risk: "moderate", reason: "file modification" };
  }

  // code_exec: escalate when code contains a system-level operation.
  if (name === "code_exec") {
    const code = (input.code as string) || "";
    if (isDangerousCode(code)) {
      return { risk: "dangerous", reason: "code contains system-level operation" };
    }
    if (baseTier) return { risk: baseTier, reason: "code execution" };
    return { risk: "moderate", reason: "code execution" };
  }

  // http_request: GET keeps the safe-tier baseline; mutating methods are moderate.
  if (name === "http_request") {
    const method = ((input.method as string) || "GET").toUpperCase();
    if (MUTATION_METHODS.has(method)) {
      return { risk: "moderate", reason: `HTTP ${method} request` };
    }
    return { risk: "safe", reason: "HTTP GET request" };
  }

  // Tools with a declared effect: derive tier directly.
  if (effect) {
    if (baseTier === "safe") return { risk: "safe", reason: "read-only tool" };
    if (baseTier === "dangerous") return { risk: "dangerous", reason: `${name} is a high-risk operation` };
    return { risk: "moderate", reason: `${name} modifies state` };
  }

  // Unknown tools default to moderate.
  return { risk: "moderate", reason: "unclassified tool" };
}

// ─── MCP annotations ──────────────────────────────────────────────────

/**
 * Derive MCP tool annotations from the tool's declared effect.
 *
 * Returns undefined when the tool has no registered effect (the lookup
 * cannot describe an unknown tool, and MCP omits annotations in that case).
 */
export function getToolMcpAnnotations(toolName: string): McpToolAnnotations | undefined {
  const effect = getToolEffect(toolName);
  if (!effect) return undefined;
  return mcpAnnotationsFromEffect(effect);
}
