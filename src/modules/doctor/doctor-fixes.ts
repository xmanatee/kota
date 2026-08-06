import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "#core/util/process-alive.js";
import type { DoctorRepairResult } from "./client.js";

function isStaleRunInsightFile(path: string): boolean {
  const raw = readFileSync(path, "utf-8");
  if (!raw.startsWith("---\n")) return false;
  const end = raw.indexOf("\n---", 4);
  return end !== -1 && /^type:\s*run-insight\s*$/m.test(raw.slice(4, end));
}

export function listStaleRunInsightFiles(projectDir: string): string[] {
  const dataDir = join(projectDir, ".kota", "data");
  if (!existsSync(dataDir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(dataDir, entry.name);
    if (isStaleRunInsightFile(path)) files.push(path);
  }
  return files;
}

export function runDoctorFixes(projectDir: string): DoctorRepairResult[] {
  const results: DoctorRepairResult[] = [];
  const kotaDir = join(projectDir, ".kota");
  const lockFile = join(kotaDir, "daemon-control.json");

  if (existsSync(lockFile)) {
    try {
      const addr = JSON.parse(readFileSync(lockFile, "utf-8")) as { pid?: number };
      if (typeof addr.pid === "number" && !isProcessAlive(addr.pid)) {
        unlinkSync(lockFile);
        results.push({
          item: "Daemon lock file (.kota/daemon-control.json)",
          action: "repaired",
          detail: `Removed stale lock file (pid ${addr.pid} not alive)`,
        });
      } else {
        results.push({
          item: "Daemon lock file (.kota/daemon-control.json)",
          action: "skipped",
          detail: "Daemon process is alive",
        });
      }
    } catch {
      results.push({
        item: "Daemon lock file (.kota/daemon-control.json)",
        action: "manual",
        detail: "Could not parse lock file — inspect and remove manually if stale",
      });
    }
  } else {
    results.push({
      item: "Daemon lock file (.kota/daemon-control.json)",
      action: "skipped",
      detail: "No lock file present",
    });
  }

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

  for (const strayDir of ["runs", "kota"]) {
    const strayPath = join(projectDir, strayDir);
    if (!existsSync(strayPath)) continue;
    try {
      rmSync(strayPath, { recursive: true, force: true });
      results.push({
        item: `Stray directory: ${strayDir}/`,
        action: "repaired",
        detail: "Removed stray runtime directory outside .kota/",
      });
    } catch (err) {
      results.push({
        item: `Stray directory: ${strayDir}/`,
        action: "manual",
        detail: `Could not remove: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const staleRunInsightFiles = listStaleRunInsightFiles(projectDir);
  if (staleRunInsightFiles.length > 0) {
    for (const file of staleRunInsightFiles) unlinkSync(file);
    results.push({
      item: "Stale run-insight knowledge files",
      action: "repaired",
      detail: `Removed ${staleRunInsightFiles.length} file(s) from .kota/data/`,
    });
  }
  return results;
}
