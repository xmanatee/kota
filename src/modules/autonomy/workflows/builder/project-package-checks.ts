import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type RunCheckOptions,
  runCheck,
} from "#modules/autonomy/shared.js";

const PACKAGE_PROJECT_MARKERS = [
  "package.json",
  "package.yaml",
  "package.json5",
  "pnpm-workspace.yaml",
] as const;

function hasPackageProject(projectDir: string): boolean {
  return PACKAGE_PROJECT_MARKERS.some((marker) =>
    existsSync(join(projectDir, marker))
  );
}

export async function checkPackageScript(
  projectDir: string,
  command: string,
  options: RunCheckOptions = {},
): Promise<string> {
  if (!hasPackageProject(projectDir)) {
    return "OK: no package project present";
  }
  return runCheck(command, projectDir, options);
}

export async function checkMacosSwiftBuild(
  projectDir: string,
  options: Pick<RunCheckOptions, "signal"> = {},
): Promise<string> {
  const appleDir = join(projectDir, "clients/apple");
  if (!existsSync(join(appleDir, "Package.swift"))) {
    return "OK: no Apple client present";
  }
  return runCheck("swift build", appleDir, {
    timeoutMs: 180_000,
    signal: options.signal,
  });
}
