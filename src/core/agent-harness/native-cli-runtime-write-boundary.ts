import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { MachineAuthorityWriteBoundary } from "./machine-authority-sandbox.js";

function assertedRuntimeDescendant(
  value: string | undefined,
  expectedParent: string,
  name: string,
): string | undefined {
  if (value === undefined) return undefined;
  const candidate = resolve(value);
  const child = relative(expectedParent, candidate);
  if (
    child.length === 0 ||
    child.includes(sep) ||
    child === ".." ||
    isAbsolute(child)
  ) {
    throw new Error(
      `native CLI sandbox rejected ${name} outside its invocation-scoped runtime directory`,
    );
  }
  return candidate;
}

export function nativeCliRuntimeWriteBoundary(
  cwd: string,
  env: NodeJS.ProcessEnv,
): MachineAuthorityWriteBoundary | undefined {
  const runtimeRoot = join(resolve(cwd), ".kota");
  if (!existsSync(runtimeRoot)) return undefined;
  const agentRunDir = assertedRuntimeDescendant(
    env.KOTA_RUN_DIR,
    join(runtimeRoot, "builder-evidence"),
    "KOTA_RUN_DIR",
  );
  const tempRoot = assertedRuntimeDescendant(
    env.KOTA_RUN_TEMP_DIR,
    join(runtimeRoot, "tmp"),
    "KOTA_RUN_TEMP_DIR",
  );
  const artifactRoot = env.KOTA_RUN_ARTIFACT_DIR;
  if (
    artifactRoot !== undefined &&
    (agentRunDir === undefined || resolve(artifactRoot) !== join(agentRunDir, "artifacts"))
  ) {
    throw new Error(
      "native CLI sandbox rejected KOTA_RUN_ARTIFACT_DIR outside the invocation evidence directory",
    );
  }
  return {
    root: runtimeRoot,
    writableDescendants: [agentRunDir, tempRoot].filter(
      (path): path is string => path !== undefined,
    ),
  };
}
