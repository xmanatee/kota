import {
  localDestructiveEffect,
  localWriteEffect,
  networkDestructiveEffect,
  networkReadEffect,
  networkWriteEffect,
  type ToolEffect,
} from "./effect.js";
import {
  isDangerousCode,
  isDangerousCommand,
} from "./guardrails-danger-patterns.js";
import type { ToolEffectResolver } from "./tool-effect-registry.js";

type OpaqueExecutionInput = Parameters<ToolEffectResolver>[0];

const NETWORK_SURFACE_PATTERNS = [
  /\b(?:curl|wget|httpie|xh|ftp|sftp|scp|ssh|rsync|nc|ncat|netcat|telnet)\b/i,
  /\bgit\s+(?:clone|fetch|pull|push|ls-remote)\b/i,
  /\b(?:npm|pnpm|yarn)\s+(?:add|install|update|publish|dlx)\b/i,
  /\b(?:pip|pip3|uv)\s+(?:install|download)\b/i,
  /\b(?:fetch|axios|got|undici|requests|httpx|aiohttp)\s*(?:\.|\()/i,
  /\b(?:https?|http2)\.(?:get|request)\s*\(/i,
  /\b(?:require|import)\s*\(?\s*["'](?:node:)?https?["']/i,
  /\bhttps?:\/\//i,
] as const;

const NETWORK_WRITE_PATTERNS = [
  /(?:-X|--request(?:=|\s+))\s*["']?(?:POST|PUT|PATCH)\b/i,
  /\bmethod\s*[:=]\s*["'](?:POST|PUT|PATCH)["']/i,
  /\b(?:requests|httpx|axios|client|session)\.(?:post|put|patch)\s*\(/i,
  /\bcurl\b[^\n]*(?:--data(?:-ascii|-binary|-raw|-urlencode)?\b|-d\b|--form\b|-F\b|--upload-file\b|-T\b)/i,
  /\bwget\b[^\n]*(?:--post-data\b|--post-file\b)/i,
  /\b(?:scp|sftp|rsync)\b/i,
] as const;

const NETWORK_DESTRUCTIVE_PATTERNS = [
  /(?:-X|--request(?:=|\s+))\s*["']?DELETE\b/i,
  /\bmethod\s*[:=]\s*["']DELETE["']/i,
  /\b(?:requests|httpx|axios|client|session)\.delete\s*\(/i,
  /\bgit\s+push\b/i,
  /\b(?:npm|pnpm|yarn)\s+publish\b/i,
] as const;

function executionSource(
  toolName: string,
  input: OpaqueExecutionInput,
): { source: string; kind: "code" | "command" } | undefined {
  if (toolName === "code_exec") {
    return typeof input.code === "string"
      ? { source: input.code, kind: "code" }
      : undefined;
  }
  if (toolName === "process" && input.action !== "start") return undefined;
  if (toolName !== "Bash" && toolName !== "process" && toolName !== "shell") {
    return undefined;
  }
  return typeof input.command === "string"
    ? { source: input.command, kind: "command" }
    : undefined;
}

function matchesAny(source: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(source));
}

export function resolveOpaqueExecutionNetworkEffect(
  toolName: string,
  input: OpaqueExecutionInput,
): ToolEffect | undefined {
  const execution = executionSource(toolName, input);
  if (!execution || !matchesAny(execution.source, NETWORK_SURFACE_PATTERNS)) {
    return undefined;
  }
  if (matchesAny(execution.source, NETWORK_DESTRUCTIVE_PATTERNS)) {
    return networkDestructiveEffect();
  }
  if (matchesAny(execution.source, NETWORK_WRITE_PATTERNS)) {
    return networkWriteEffect();
  }
  return networkReadEffect();
}

export function resolveOpaqueExecutionLocalEffect(
  toolName: string,
  input: OpaqueExecutionInput,
): ToolEffect | undefined {
  const execution = executionSource(toolName, input);
  if (!execution) return undefined;
  const destructive = execution.kind === "code"
    ? isDangerousCode(execution.source)
    : isDangerousCommand(execution.source);
  return destructive ? localDestructiveEffect() : localWriteEffect();
}

export function resolveOpaqueExecutionEffects(
  toolName: string,
  input: OpaqueExecutionInput,
): readonly ToolEffect[] | undefined {
  const local = resolveOpaqueExecutionLocalEffect(toolName, input);
  if (!local) return undefined;
  const network = resolveOpaqueExecutionNetworkEffect(toolName, input);
  return network ? [local, network] : [local];
}

export function resolveOpaqueExecutionPrimaryEffect(
  toolName: string,
  input: OpaqueExecutionInput,
): ToolEffect | undefined {
  return resolveOpaqueExecutionNetworkEffect(toolName, input)
    ?? resolveOpaqueExecutionLocalEffect(toolName, input);
}
