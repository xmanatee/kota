import type { SpawnSyncReturns } from "node:child_process";

export function diagnosticText(result: SpawnSyncReturns<string>): string {
  const parts = [
    result.error?.message,
    typeof result.stdout === "string" ? result.stdout.trim() : "",
    typeof result.stderr === "string" ? result.stderr.trim() : "",
  ].filter((part) => part !== undefined && part.length > 0);
  return parts.join("\n");
}
