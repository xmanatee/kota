import { type SpawnSyncReturns, spawnSync } from "node:child_process";

const CAPABILITY_PROBE_TIMEOUT_MS = 2_000;

export function runScientificClaimCapabilityProbe(
  command: string,
  args: readonly string[],
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    encoding: "utf8",
    env: { LANG: "C", LC_ALL: "C", NO_COLOR: "1" },
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: CAPABILITY_PROBE_TIMEOUT_MS,
  });
}

export function scientificClaimCapabilityProbePassed(
  result: SpawnSyncReturns<string>,
  evidence: string,
): boolean {
  return result.status === 0 && result.stdout.includes(evidence);
}

export function describeScientificClaimCapabilityProbeFailure(
  label: string,
  result: SpawnSyncReturns<string>,
): string {
  const diagnostics = [result.stdout, result.stderr, result.error?.message]
    .filter(
      (value): value is string =>
        typeof value === "string" && value.length > 0,
    )
    .join("\n")
    .trim();
  const outcome =
    result.signal !== null
      ? `signal ${result.signal}`
      : `status ${result.status ?? "unknown"}`;
  return `${label} failed (${outcome})${diagnostics.length > 0 ? `: ${diagnostics}` : ""}`;
}
