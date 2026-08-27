import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { MachineAuthorityWriteBoundary } from "./machine-authority-sandbox.js";

function pathIsWithin(root: string, candidate: string): boolean {
  const child = relative(resolve(root), resolve(candidate));
  return child === "" || (
    child !== ".." &&
    !child.startsWith(`..${sep}`) &&
    !isAbsolute(child)
  );
}

function assertedRuntimePath(
  value: string | undefined,
  runtimeRoot: string,
  writableRoots: readonly string[],
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  const candidate = resolve(value);
  if (
    !pathIsWithin(runtimeRoot, candidate) ||
    !writableRoots.some((root) => pathIsWithin(root, candidate))
  ) {
    throw new Error(
      `native CLI sandbox rejected ${name} outside its run-owned runtime directories`,
    );
  }
  return candidate;
}

export function nativeCliRuntimeWriteBoundary(
  runtimeStateRoot: string,
  env: NodeJS.ProcessEnv,
  writableRoots: readonly string[] = [],
): MachineAuthorityWriteBoundary | undefined {
  const runtimeRoot = resolve(runtimeStateRoot);
  if (!existsSync(runtimeRoot)) return undefined;
  const approvedRoots = [...new Set(writableRoots.map((path) => resolve(path)))];
  for (const root of approvedRoots) {
    if (root === runtimeRoot || !pathIsWithin(runtimeRoot, root)) {
      throw new Error(
        "native CLI sandbox rejected a writable root outside run-owned runtime state",
      );
    }
  }
  assertedRuntimePath(
    env.KOTA_RUN_DIR,
    runtimeRoot,
    approvedRoots,
    "KOTA_RUN_DIR",
  );
  assertedRuntimePath(
    env.KOTA_RUN_TEMP_DIR,
    runtimeRoot,
    approvedRoots,
    "KOTA_RUN_TEMP_DIR",
  );
  assertedRuntimePath(
    env.KOTA_RUN_ARTIFACT_DIR,
    runtimeRoot,
    approvedRoots,
    "KOTA_RUN_ARTIFACT_DIR",
  );
  return {
    root: runtimeRoot,
    writableDescendants: approvedRoots,
  };
}
