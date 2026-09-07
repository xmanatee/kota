import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "#core/util/process-alive.js";
import type { AutonomyHealthJsonValue } from "#modules/autonomy/health-signal.js";
import { isAutonomyHealthJsonObject } from "#modules/autonomy/health-signal.js";

export type DaemonControlHealth =
  | { kind: "missing" }
  | { kind: "unreadable" }
  | { kind: "fresh"; pid: number; baseURL: string }
  | { kind: "stale"; pid: number; baseURL: string };

export function classifyDaemonControlFileForAudit(
  stateDir: string,
): DaemonControlHealth {
  const controlPath = join(stateDir, "daemon-control.json");
  if (!existsSync(controlPath)) return { kind: "missing" };
  let parsed: AutonomyHealthJsonValue;
  try {
    parsed = JSON.parse(readFileSync(controlPath, "utf-8")) as AutonomyHealthJsonValue;
  } catch {
    return { kind: "unreadable" };
  }
  if (
    !isAutonomyHealthJsonObject(parsed) ||
    typeof parsed.port !== "number" ||
    typeof parsed.pid !== "number"
  ) {
    return { kind: "unreadable" };
  }
  const baseURL = `http://127.0.0.1:${parsed.port}`;
  return isProcessAlive(parsed.pid)
    ? { kind: "fresh", pid: parsed.pid, baseURL }
    : { kind: "stale", pid: parsed.pid, baseURL };
}
