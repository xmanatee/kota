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

import { realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
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

export type EnvironmentOverrideClass =
  | "credential/token"
  | "provider/profile"
  | "endpoint"
  | "KOTA control"
  | "telemetry routing"
  | "preset/harness"
  | "permission/sandbox"
  | "project/root"
  | "unclassified";

export type AuthorityChangingEnvironmentOverride = {
  name: string;
  overrideClass: EnvironmentOverrideClass;
};

const BENIGN_ENVIRONMENT_OVERRIDE_NAMES = new Set([
  "CI",
  "FORCE_COLOR",
  "KOTA_RENDERER_THEME",
  "NO_COLOR",
]);

const SHELL_ENV_ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)=/;
const CREDENTIAL_ENV_PATTERN =
  /(^|_)(TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY|CREDENTIALS?|AUTH|COOKIE|SESSION|BEARER|OAUTH|PAT)(_|$)/;
const PROVIDER_PROFILE_ENV_PATTERN =
  /(^|_)(PROFILE|AWS|AZURE|GOOGLE|GCP|GCLOUD|CLOUDSDK|OPENAI|ANTHROPIC|GITHUB|GH|GITLAB|NPM|PNPM|YARN|HF|HUGGINGFACE)(_|$)/;
const ENDPOINT_ENV_PATTERN =
  /(^|_)(ENDPOINT|BASE_URL|API_URL|URL|URI|HOST|PROXY|REGISTRY)(_|$)/;
const TELEMETRY_ENV_PATTERN =
  /(^|_)(OTEL|OPENTELEMETRY|TELEMETRY|TRACING|TRACE|OTLP|EXPORTER)(_|$)/;
const PRESET_HARNESS_ENV_PATTERN = /(^|_)(PRESET|HARNESS|MODEL)(_|$)/;
const PERMISSION_SANDBOX_ENV_PATTERN =
  /(^|_)(PERMISSION|SANDBOX|APPROVAL|BYPASS|ALLOWLIST|DENYLIST|UNSAFE)(_|$)/;
const PROJECT_ROOT_ENV_PATTERN =
  /(^|_)(PROJECT_DIR|PROJECT_ROOT|WORKSPACE|WORKDIR|REPO_ROOT|ROOT|HOME|PWD)(_|$)/;
const DIRECTORY_CHANGING_COMMANDS = new Set(["cd", "pushd"]);

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

function resolvePathFrom(baseDirectory: string, targetPath: string): string {
  return isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(baseDirectory, targetPath);
}

function resolveBoundaryPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

function isPathInsideProject(resolvedPath: string): boolean {
  const projectRoot = resolveBoundaryPath(resolve(process.cwd()));
  const relativePath = relative(projectRoot, resolvedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function isOutsideProject(
  filePath: string,
  baseDirectory = process.cwd(),
): boolean {
  return !isPathInsideProject(resolveBoundaryPath(resolvePathFrom(baseDirectory, filePath)));
}

function skipShellWhitespace(command: string, index: number): number {
  let next = index;
  while (next < command.length && /\s/.test(command[next])) next += 1;
  return next;
}

function readShellWordEnd(command: string, index: number): number {
  let next = index;
  let quote: "'" | "\"" | null = null;

  while (next < command.length) {
    const char = command[next];
    if (quote) {
      if (char === quote) {
        quote = null;
        next += 1;
        continue;
      }
      if (quote === "\"" && char === "\\" && next + 1 < command.length) {
        next += 2;
        continue;
      }
      next += 1;
      continue;
    }

    if (/\s/.test(char)) break;
    if (char === "'" || char === "\"") {
      quote = char;
      next += 1;
      continue;
    }
    if (char === "\\" && next + 1 < command.length) {
      next += 2;
      continue;
    }
    next += 1;
  }

  return next;
}

type ShellWord = {
  value: string;
  end: number;
};

function readShellWord(command: string, index: number): ShellWord | null {
  let next = skipShellWhitespace(command, index);
  if (next >= command.length || /[&;|<>()]/.test(command[next])) return null;

  let value = "";
  let quote: "'" | "\"" | null = null;

  while (next < command.length) {
    const char = command[next];
    if (quote) {
      if (char === quote) {
        quote = null;
        next += 1;
        continue;
      }
      if (quote === "\"" && char === "\\" && next + 1 < command.length) {
        value += command[next + 1];
        next += 2;
        continue;
      }
      value += char;
      next += 1;
      continue;
    }

    if (/\s/.test(char) || /[&;|<>()]/.test(char)) break;
    if (char === "'" || char === "\"") {
      quote = char;
      next += 1;
      continue;
    }
    if (char === "\\" && next + 1 < command.length) {
      value += command[next + 1];
      next += 2;
      continue;
    }
    value += char;
    next += 1;
  }

  if (quote) return null;
  return { value, end: next };
}

function skipLeadingEnvironmentAssignments(command: string): number {
  let index = skipShellWhitespace(command, 0);

  while (index < command.length) {
    const match = SHELL_ENV_ASSIGNMENT_PATTERN.exec(command.slice(index));
    if (!match) break;
    index = skipShellWhitespace(
      command,
      readShellWordEnd(command, index + match[0].length),
    );
  }

  return index;
}

export function extractLeadingEnvironmentOverrideNames(command: string): string[] {
  const names: string[] = [];
  let index = skipShellWhitespace(command, 0);

  while (index < command.length) {
    const match = SHELL_ENV_ASSIGNMENT_PATTERN.exec(command.slice(index));
    if (!match) break;
    names.push(match[1]);
    index = skipShellWhitespace(
      command,
      readShellWordEnd(command, index + match[0].length),
    );
  }

  return names;
}

export function classifyEnvironmentOverride(
  name: string,
): EnvironmentOverrideClass | null {
  const normalized = name.toUpperCase();
  if (BENIGN_ENVIRONMENT_OVERRIDE_NAMES.has(normalized)) return null;
  if (CREDENTIAL_ENV_PATTERN.test(normalized)) return "credential/token";
  if (normalized.startsWith("KOTA_")) return "KOTA control";
  if (TELEMETRY_ENV_PATTERN.test(normalized)) return "telemetry routing";
  if (ENDPOINT_ENV_PATTERN.test(normalized)) return "endpoint";
  if (PROVIDER_PROFILE_ENV_PATTERN.test(normalized)) return "provider/profile";
  if (PRESET_HARNESS_ENV_PATTERN.test(normalized)) return "preset/harness";
  if (PERMISSION_SANDBOX_ENV_PATTERN.test(normalized)) return "permission/sandbox";
  if (PROJECT_ROOT_ENV_PATTERN.test(normalized)) return "project/root";
  return "unclassified";
}

export function findAuthorityChangingEnvironmentOverrides(
  command: string,
): AuthorityChangingEnvironmentOverride[] {
  const overrides: AuthorityChangingEnvironmentOverride[] = [];
  for (const name of extractLeadingEnvironmentOverrideNames(command)) {
    const overrideClass = classifyEnvironmentOverride(name);
    if (overrideClass) overrides.push({ name, overrideClass });
  }
  return overrides;
}

function formatEnvironmentOverrideReasons(
  overrides: AuthorityChangingEnvironmentOverride[],
): string[] {
  return overrides.map(
    ({ name, overrideClass }) =>
      `${overrideClass} environment override detected (${name})`,
  );
}

function hasDirectoryChangeContinuation(command: string, index: number): boolean {
  const next = skipShellWhitespace(command, index);
  return command.startsWith("&&", next) || command.startsWith(";", next);
}

function isDeterministicDirectoryOperand(directory: string): boolean {
  return (
    directory.length > 0 &&
    directory !== "-" &&
    !directory.startsWith("~") &&
    !/[$`*?[]/.test(directory)
  );
}

function isCdOptionWord(word: string): boolean {
  return /^-[LP]+$/.test(word);
}

function readDirectoryOperand(
  command: string,
  index: number,
  commandName: string,
): ShellWord | null {
  let directoryWord = readShellWord(command, index);
  if (!directoryWord) return null;

  if (commandName === "cd") {
    while (isCdOptionWord(directoryWord.value)) {
      directoryWord = readShellWord(command, directoryWord.end);
      if (!directoryWord) return null;
    }
  }

  if (directoryWord.value === "--") {
    directoryWord = readShellWord(command, directoryWord.end);
    if (!directoryWord) return null;
  }

  return directoryWord;
}

function extractLeadingDirectoryChange(command: string): string | null {
  let index = skipLeadingEnvironmentAssignments(command);
  const commandWord = readShellWord(command, index);
  if (!commandWord || !DIRECTORY_CHANGING_COMMANDS.has(commandWord.value)) {
    return null;
  }

  index = commandWord.end;
  const directoryWord = readDirectoryOperand(command, index, commandWord.value);
  if (!directoryWord) return null;
  if (!hasDirectoryChangeContinuation(command, directoryWord.end)) return null;
  if (!isDeterministicDirectoryOperand(directoryWord.value)) return null;
  return directoryWord.value;
}

function formatWorkingDirectoryReasons(
  command: string,
  cwdInput: string | undefined,
): string[] {
  const reasons: string[] = [];
  const commandStartDirectory = cwdInput
    ? resolvePathFrom(process.cwd(), cwdInput)
    : process.cwd();

  if (cwdInput && isOutsideProject(cwdInput)) {
    reasons.push("project/root working directory override detected");
  }

  const changedDirectory = extractLeadingDirectoryChange(command);
  if (changedDirectory && isOutsideProject(changedDirectory, commandStartDirectory)) {
    reasons.push("project/root directory-changing command detected");
  }

  return reasons;
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

  // File write/edit family: escalate when the path leaves the project root.
  if (
    name === "file_write" ||
    name === "file_edit" ||
    name === "multi_edit" ||
    name === "find_replace"
  ) {
    const path = input.path || input.file_path || input.file;
    if (typeof path === "string" && isOutsideProject(path)) {
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
