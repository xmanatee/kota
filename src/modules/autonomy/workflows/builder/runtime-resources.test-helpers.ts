import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import { setBuilderPortAvailabilityCheckerForTest } from "./runtime-resource-ports.js";

const tempDirs: string[] = [];
let unavailablePorts = new Set<number>();
let resetPortAvailabilityChecker: (() => void) | null = null;

export function tempProject(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kota-builder-runtime-${label}-`));
  tempDirs.push(dir);
  return dir;
}

export function markPortUnavailable(port: number): void {
  unavailablePorts.add(port);
}

export function rangesOverlap(
  left: { start: number; end: number },
  right: { start: number; end: number },
): boolean {
  return left.start <= right.end && right.start <= left.end;
}

export function installRuntimeResourceTestHooks(): void {
  beforeEach(() => {
    unavailablePorts = new Set();
    resetPortAvailabilityChecker = setBuilderPortAvailabilityCheckerForTest(
      async (port) => !unavailablePorts.has(port),
    );
  });

  afterEach(() => {
    resetPortAvailabilityChecker?.();
    resetPortAvailabilityChecker = null;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

export async function withEvalHarnessReplayRoot<T>(
  replayRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const previousReplayRoot = process.env.KOTA_EVAL_HARNESS_REPLAY_ROOT;
  process.env.KOTA_EVAL_HARNESS_REPLAY_ROOT = replayRoot;
  try {
    return await run();
  } finally {
    if (previousReplayRoot === undefined) {
      delete process.env.KOTA_EVAL_HARNESS_REPLAY_ROOT;
    } else {
      process.env.KOTA_EVAL_HARNESS_REPLAY_ROOT = previousReplayRoot;
    }
  }
}
