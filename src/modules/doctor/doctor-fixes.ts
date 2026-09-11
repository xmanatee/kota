import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "#core/util/process-alive.js";
import type { DoctorRepairResult } from "./client.js";

export function repairStaleDaemonControl(scopeRoot: string): DoctorRepairResult {
  const lockFile = join(scopeRoot, ".kota", "daemon-control.json");
  if (existsSync(lockFile)) {
    try {
      const addr = JSON.parse(readFileSync(lockFile, "utf-8")) as { pid?: number };
      const pid = addr.pid;
      if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
        return { item: "Daemon lock file (.kota/daemon-control.json)", action: "manual", detail: "Control file has no valid process identity" };
      }
      if (!isProcessAlive(pid)) {
        unlinkSync(lockFile);
        return {
          item: "Daemon lock file (.kota/daemon-control.json)",
          action: "repaired",
          detail: `Removed stale lock file (pid ${addr.pid} not alive)`,
        };
      } else {
        return {
          item: "Daemon lock file (.kota/daemon-control.json)",
          action: "skipped",
          detail: "Daemon process is alive",
        };
      }
    } catch (error) {
      return {
        item: "Daemon lock file (.kota/daemon-control.json)",
        action: "manual",
        detail: `Could not repair control file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else {
    return {
      item: "Daemon lock file (.kota/daemon-control.json)",
      action: "skipped",
      detail: "No lock file present",
    };
  }
}

export function runDoctorFixes(scopeRoot: string): DoctorRepairResult[] {
  const results = [repairStaleDaemonControl(scopeRoot)];
  const kotaDir = join(scopeRoot, ".kota");

  for (const dir of [kotaDir, join(kotaDir, "runs"), join(kotaDir, "modules")]) {
    if (existsSync(dir)) {
      results.push({ item: `Directory: ${dir}`, action: "skipped", detail: "Already present" });
      continue;
    }
    try {
      mkdirSync(dir, { recursive: true });
      results.push({ item: `Directory: ${dir}`, action: "repaired", detail: "Created" });
    } catch (err) {
      results.push({
        item: `Directory: ${dir}`,
        action: "manual",
        detail: `Could not create: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return results;
}
