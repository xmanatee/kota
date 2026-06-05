import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isProcessAlive } from "#core/util/process-alive.js";

export type StrandedDaemonProcess = {
  pid: number;
  command: string;
};

export type StrandedDaemonInspection =
  | { kind: "none" }
  | ({ kind: "stranded" } & StrandedDaemonProcess);

type DetectStrandedDaemonOptions = {
  processIsAlive?: (pid: number) => boolean;
  readProcessCommand?: (pid: number) => string | null;
};

export function isKotaDaemonCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  return (
    /(?:^|\s)\S*(?:dist\/cli\.js|src\/cli\.ts|bin\/kota\.mjs)\s+daemon(?:\s|$)/.test(normalized) ||
    /(?:^|\s)kota\s+daemon(?:\s|$)/.test(normalized)
  );
}

function readDaemonStatePid(projectDir: string): number | null {
  const statePath = join(projectDir, ".kota", "daemon-state.json");
  if (!existsSync(statePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf-8")) as { pid?: number };
    return typeof parsed.pid === "number" ? parsed.pid : null;
  } catch {
    return null;
  }
}

function readDefaultProcessCommand(pid: number): string | null {
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024,
      timeout: 1_000,
    }).trim();
    return command.length > 0 ? command : null;
  } catch {
    return null;
  }
}

export function detectStrandedDaemonProcess(
  projectDir: string,
  options: DetectStrandedDaemonOptions = {},
): StrandedDaemonInspection {
  if (existsSync(join(projectDir, ".kota", "daemon-control.json"))) {
    return { kind: "none" };
  }

  const pid = readDaemonStatePid(projectDir);
  if (pid === null) return { kind: "none" };
  const processIsAlive = options.processIsAlive ?? isProcessAlive;
  if (!processIsAlive(pid)) return { kind: "none" };

  const readProcessCommand = options.readProcessCommand ?? readDefaultProcessCommand;
  const command = readProcessCommand(pid);
  if (command === null || !isKotaDaemonCommand(command)) return { kind: "none" };

  return { kind: "stranded", pid, command };
}
