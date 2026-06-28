import {
  existsSync,
  lstatSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";

export type BuilderRuntimeDependencyPreflight =
  | {
      status: "skipped";
      reason: "no-package-json" | "no-dependencies";
      checkedAt: string;
    }
  | {
      status: "passed";
      action: "workspace-node-modules-present" | "linked-project-node-modules";
      checkedAt: string;
      path: string;
      source?: string;
    };

type PackageJsonDependencyView = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function hasDependencyEntries(deps: Record<string, string> | undefined): boolean {
  return deps !== undefined && Object.keys(deps).length > 0;
}

function packageDeclaresDependencies(packageJsonPath: string): boolean {
  const pkg = JSON.parse(
    readFileSync(packageJsonPath, "utf8"),
  ) as PackageJsonDependencyView;
  return (
    hasDependencyEntries(pkg.dependencies) ||
    hasDependencyEntries(pkg.devDependencies) ||
    hasDependencyEntries(pkg.optionalDependencies) ||
    hasDependencyEntries(pkg.peerDependencies)
  );
}

function assertNodeModulesUsable(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() && !stat.isSymbolicLink()) {
    throw new Error(
      `Builder dependency setup preflight failed: ${path} exists but is not a directory or symlink`,
    );
  }
}

export function preflightDependencySetup(input: {
  projectDir: string;
  workspaceDir: string;
}): BuilderRuntimeDependencyPreflight {
  const checkedAt = new Date().toISOString();
  const packageJsonPath = join(input.workspaceDir, "package.json");
  if (!existsSync(packageJsonPath)) {
    return { status: "skipped", reason: "no-package-json", checkedAt };
  }
  if (!packageDeclaresDependencies(packageJsonPath)) {
    return { status: "skipped", reason: "no-dependencies", checkedAt };
  }

  const workspaceNodeModules = join(input.workspaceDir, "node_modules");
  if (existsSync(workspaceNodeModules)) {
    assertNodeModulesUsable(workspaceNodeModules);
    return {
      status: "passed",
      action: "workspace-node-modules-present",
      checkedAt,
      path: workspaceNodeModules,
    };
  }

  const projectNodeModules = join(input.projectDir, "node_modules");
  if (!existsSync(projectNodeModules)) {
    throw new Error(
      `Builder dependency setup preflight failed: package dependencies are declared but ${projectNodeModules} does not exist`,
    );
  }
  try {
    symlinkSync(
      projectNodeModules,
      workspaceNodeModules,
      process.platform === "win32" ? "junction" : "dir",
    );
  } catch (error) {
    throw new Error(
      `Builder dependency setup preflight failed: could not link ${workspaceNodeModules} to ${projectNodeModules}: ${(error as Error).message}`,
    );
  }
  return {
    status: "passed",
    action: "linked-project-node-modules",
    checkedAt,
    path: workspaceNodeModules,
    source: projectNodeModules,
  };
}
