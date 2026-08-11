import { createHash } from "node:crypto";

export const KOTA_AGENT_COMMAND_TRACE_ALGORITHM =
  "sha256-normalized-shell-segments-v1" as const;

export type KotaAgentCommandTrace = {
  algorithm: typeof KOTA_AGENT_COMMAND_TRACE_ALGORITHM;
  exactDigests: readonly string[];
  prefixDigests: readonly string[];
};

function normalizedCommand(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function commandSegments(value: string): string[] {
  return value
    .split(/&&|\|\||[;|\n]/)
    .map((segment) => normalizedCommand(segment).replace(/^\(+|\)+$/g, ""))
    .filter((segment) => segment.length > 0);
}

function commandPrefixes(command: string): string[] {
  const prefixes = [command];
  for (let index = 0; index < command.length; index += 1) {
    if (command[index] === " ") prefixes.push(command.slice(0, index));
  }
  return prefixes;
}

function commandDigest(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

/**
 * Derive durable command evidence without retaining provider-owned tool input.
 * Exact digests prove required commands; prefix digests detect prohibited
 * command families such as `git commit` including invocations with arguments.
 */
export function buildKotaAgentCommandTrace(command: string): KotaAgentCommandTrace {
  const segments = commandSegments(command);
  return {
    algorithm: KOTA_AGENT_COMMAND_TRACE_ALGORITHM,
    exactDigests: [...new Set(segments.map(commandDigest))].sort(),
    prefixDigests: [
      ...new Set(
        segments.flatMap((segment) => commandPrefixes(segment).map(commandDigest)),
      ),
    ].sort(),
  };
}

export function kotaAgentCommandTraceMatches(
  trace: KotaAgentCommandTrace,
  command: string,
  match: "exact" | "prefix",
): boolean {
  const expected = commandSegments(command);
  if (expected.length !== 1) return false;
  const digest = commandDigest(expected[0]);
  return match === "exact"
    ? trace.exactDigests.includes(digest)
    : trace.prefixDigests.includes(digest);
}
