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

import { findModuleManifestToolEffect } from "#core/modules/module-manifest.js";
import {
  type McpToolAnnotations,
  mcpAnnotationsFromEffect,
  type RiskTier,
  riskFromEffect,
  type ToolEffectKind,
} from "./effect.js";
import {
  DANGEROUS_CODE_PATTERNS,
  DANGEROUS_COMMAND_PATTERNS,
  isDangerousCode,
  isDangerousCommand,
  MUTATION_METHODS,
} from "./guardrails-danger-patterns.js";
import {
  type AuthorityChangingEnvironmentOverride,
  classifyEnvironmentOverride,
  type EnvironmentOverrideClass,
  extractLeadingEnvironmentOverrideNames,
  findAuthorityChangingEnvironmentOverrides,
  formatEnvironmentOverrideReasons,
  formatWorkingDirectoryReasons,
} from "./guardrails-shell-authority.js";
import { getToolEffect } from "./index.js";
import { isPathOutsideRoot } from "./path-containment.js";

export type RiskLevel = RiskTier;
export type { McpToolAnnotations };

export type ToolCallInput = Record<string, unknown>;

export type ToolCallInputEffectOverride = {
  kind: ToolEffectKind;
  risk: RiskLevel;
  reason: string;
};

type ResolvedToolEffect =
  | { source: "manifest"; risk: RiskLevel }
  | { source: "registry"; risk: RiskLevel };

const RISK_RANK: Record<RiskLevel, number> = {
  safe: 0,
  moderate: 1,
  dangerous: 2,
};

export type {
  AuthorityChangingEnvironmentOverride,
  EnvironmentOverrideClass,
};
export {
  classifyEnvironmentOverride,
  DANGEROUS_CODE_PATTERNS,
  DANGEROUS_COMMAND_PATTERNS,
  extractLeadingEnvironmentOverrideNames,
  findAuthorityChangingEnvironmentOverrides,
  isDangerousCode,
  isDangerousCommand,
  MUTATION_METHODS,
};

// ─── Helpers ──────────────────────────────────────────────────────────

export function extractCommand(input: ToolCallInput): string {
  return ((input.command as string) || "").trim();
}

function classifySaveToLocalWrite(
  input: ToolCallInput,
): ToolCallInputEffectOverride | null {
  const saveTo = input.save_to;
  if (typeof saveTo !== "string" || saveTo.length === 0) return null;
  if (isPathOutsideRoot(saveTo)) {
    return {
      kind: "write",
      risk: "dangerous",
      reason: "save_to file operation outside scope directory",
    };
  }
  return {
    kind: "write",
    risk: "moderate",
    reason: "save_to local filesystem write",
  };
}

export function classifyToolCallInputEffectOverride(
  name: string,
  input: ToolCallInput,
): ToolCallInputEffectOverride | null {
  if (name === "web_fetch" || name === "http_request") {
    const localWrite = classifySaveToLocalWrite(input);
    if (localWrite) return localWrite;
  }

  const inputEffect = getToolEffect(name, input);
  if (inputEffect) {
    const risk = riskFromEffect(inputEffect);
    const staticEffect =
      findModuleManifestToolEffect(name)?.effect ?? getToolEffect(name);
    if (!staticEffect || RISK_RANK[risk] >= RISK_RANK[riskFromEffect(staticEffect)]) {
      return {
        kind: inputEffect.kind,
        risk,
        reason: `${name} invocation has a ${inputEffect.kind} ${inputEffect.scope} effect`,
      };
    }
  }
  return null;
}

// ─── Classification ───────────────────────────────────────────────────

function resolveToolEffect(name: string): ResolvedToolEffect | undefined {
  const manifestEffect = findModuleManifestToolEffect(name);
  if (manifestEffect) {
    return {
      source: "manifest",
      risk: manifestEffect.risk,
    };
  }

  const effect = getToolEffect(name);
  if (!effect) return undefined;
  return {
    source: "registry",
    risk: riskFromEffect(effect),
  };
}

function effectReasonPrefix(
  name: string,
  resolvedEffect: ResolvedToolEffect,
): string {
  return resolvedEffect.source === "manifest" ? `${name} manifest effect` : name;
}

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
  input: ToolCallInput,
): { risk: RiskLevel; reason: string } {
  const resolvedEffect = resolveToolEffect(name);
  const baseTier = resolvedEffect?.risk;

  // Shell/process: escalate to dangerous when the command matches a
  // destructive pattern, regardless of the declared base effect.
  if (name === "shell" || name === "process") {
    const command = extractCommand(input);
    const dangerousReasons = formatEnvironmentOverrideReasons(
      findAuthorityChangingEnvironmentOverrides(command),
    );
    const cwdInput =
      name === "shell" && typeof input.cwd === "string" && input.cwd.trim()
        ? input.cwd
        : undefined;
    dangerousReasons.push(...formatWorkingDirectoryReasons(command, cwdInput));
    if (isDangerousCommand(command)) {
      dangerousReasons.push("destructive command pattern detected");
    }
    if (dangerousReasons.length > 0) {
      return { risk: "dangerous", reason: dangerousReasons.join("; ") };
    }
    if (baseTier) return { risk: baseTier, reason: "shell execution" };
    return { risk: "moderate", reason: "shell execution" };
  }

  // File write/edit family: escalate when the path leaves the scope root.
  if (
    name === "file_write" ||
    name === "file_edit" ||
    name === "multi_edit" ||
    name === "find_replace"
  ) {
    const path = name === "find_replace"
      ? input.files
      : input.path || input.file_path || input.file;
    if (typeof path === "string" && isPathOutsideRoot(path)) {
      return { risk: "dangerous", reason: "file operation outside scope directory" };
    }
    if (name === "multi_edit" && Array.isArray(input.edits)) {
      for (const edit of input.edits as { path?: string }[]) {
        if (edit.path && isPathOutsideRoot(edit.path)) {
          return { risk: "dangerous", reason: "multi_edit targets file outside scope directory" };
        }
      }
    }
    if (baseTier) return { risk: baseTier, reason: "file modification" };
    return { risk: "moderate", reason: "file modification" };
  }

  const inputEffectOverride = classifyToolCallInputEffectOverride(name, input);
  if (inputEffectOverride) {
    return {
      risk: inputEffectOverride.risk,
      reason: inputEffectOverride.reason,
    };
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

  // http_request: every outbound request is open-world network access.
  if (name === "http_request") {
    const method = ((input.method as string) || "GET").toUpperCase();
    const networkRisk: RiskLevel = baseTier === "dangerous" ? "dangerous" : "moderate";
    if (MUTATION_METHODS.has(method)) {
      return { risk: networkRisk, reason: `HTTP ${method} request` };
    }
    return { risk: networkRisk, reason: `HTTP ${method} open-world network request` };
  }

  // Tools with a declared effect: derive tier directly.
  if (resolvedEffect) {
    if (baseTier === "safe") return { risk: "safe", reason: "read-only tool" };
    if (baseTier === "dangerous") {
      return {
        risk: "dangerous",
        reason: `${effectReasonPrefix(name, resolvedEffect)} is a high-risk operation`,
      };
    }
    return {
      risk: "moderate",
      reason: `${effectReasonPrefix(name, resolvedEffect)} modifies state`,
    };
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
  const effect = findModuleManifestToolEffect(toolName)?.effect ?? getToolEffect(toolName);
  if (!effect) return undefined;
  return mcpAnnotationsFromEffect(effect);
}
