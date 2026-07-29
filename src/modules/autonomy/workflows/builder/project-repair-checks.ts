import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT_CROSS_CUTTING_FIXTURES,
  ROOT_ENTRYPOINT_SOURCES,
} from "#core/root-layout.js";
import { type RunCheckOptions, runCheck } from "#modules/autonomy/shared.js";

const PACKAGE_PROJECT_MARKERS = [
  "package.json",
  "package.yaml",
  "package.json5",
  "pnpm-workspace.yaml",
] as const;

const MOBILE_TYPECHECK_DEPENDENCY_MARKERS = [
  "node_modules/.bin/tsc",
  "node_modules/expo/tsconfig.base.json",
  "node_modules/react/package.json",
  "node_modules/react-native/package.json",
  "node_modules/@types/react/package.json",
  "node_modules/@types/jest/package.json",
] as const;

const MOBILE_TYPECHECK_VALIDATION_ONLY_PATHS = new Set([
  "clients/mobile/package.json",
  "clients/mobile/scripts/typecheck.mjs",
]);

type ImportViolation = { file: string; specifier: string };
type RepairCheckOptions = Pick<RunCheckOptions, "signal">;

export function checkModuleBoundary(projectDir: string): string {
  const srcDir = join(projectDir, "src");
  if (!existsSync(srcDir)) return "OK: no src/ directory";

  const rootFiles = readdirSync(srcDir).filter(
    (f) =>
      f.endsWith(".ts") &&
      !f.includes(".test.") &&
      !f.includes(".integration.") &&
      !f.endsWith(".d.ts") &&
      !ROOT_CROSS_CUTTING_FIXTURES.has(f),
  );
  const fileViolations = rootFiles.filter((f) => !ROOT_ENTRYPOINT_SOURCES.has(f));
  if (fileViolations.length) {
    throw new Error(
      `Unexpected production files in src/ root: ${fileViolations.join(", ")}. ` +
        `New capabilities belong in src/core/ or src/modules/. ` +
        `If this file is intentional, add it to ROOT_ENTRYPOINT_SOURCES in src/core/root-layout.ts.`,
    );
  }

  const allowedImportTargets = new Set(
    [...ROOT_ENTRYPOINT_SOURCES].map((f) => f.replace(/\.ts$/, ".js")),
  );
  const importViolations = findDisallowedRootImports(srcDir, allowedImportTargets);
  if (importViolations.length) {
    throw new Error(
      `Disallowed #root/* imports found:\n${importViolations.map((v) => `  ${v.file}: import from "${v.specifier}"`).join("\n")}\n` +
        `Only imports of approved root helpers are allowed. ` +
        `Move the target into src/core/ or src/modules/ instead.`,
    );
  }

  return "OK: no root helper drift detected";
}

function findDisallowedRootImports(
  dir: string,
  allowedTargets: Set<string>,
  baseDir?: string,
): ImportViolation[] {
  const root = baseDir ?? dir;
  const violations: ImportViolation[] = [];
  const rootImportRe = /from\s+["']#root\/([^"']+)["']/g;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      violations.push(...findDisallowedRootImports(fullPath, allowedTargets, root));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".integration.")
    ) {
      const content = readFileSync(fullPath, "utf8");
      for (const match of content.matchAll(rootImportRe)) {
        const target = match[1];
        if (!allowedTargets.has(target)) {
          const relPath = fullPath.slice(root.length + 1);
          violations.push({ file: relPath, specifier: `#root/${target}` });
        }
      }
    }
  }
  return violations;
}

export async function checkMobileTypecheck(
  projectDir: string,
  options: RepairCheckOptions = {},
): Promise<string> {
  const mobileDir = join(projectDir, "clients/mobile");
  if (!existsSync(join(mobileDir, "package.json"))) {
    return "OK: no mobile client present";
  }
  const missingDependencyMarkers = missingMobileTypecheckDependencyMarkers(mobileDir);
  if (missingDependencyMarkers.length > 0) {
    const stagedAppChanges = listStagedPathChanges(projectDir, "clients/mobile")
      .filter((path) => !MOBILE_TYPECHECK_VALIDATION_ONLY_PATHS.has(path));
    if (stagedAppChanges.length > 0) {
      throw new Error(
        [
          "Mobile client dependencies are not installed; cannot run mobile typecheck for staged mobile changes.",
          `Missing: ${missingDependencyMarkers.join(", ")}.`,
          `Changed: ${stagedAppChanges.join(", ")}.`,
          "Run `pnpm install` in clients/mobile before staging mobile edits.",
        ].join(" "),
      );
    }
    return "OK: mobile client dependencies not installed; no staged mobile changes";
  }
  return runCheck("pnpm run typecheck", mobileDir, {
    timeoutMs: 60_000,
    signal: options.signal,
  });
}

function missingMobileTypecheckDependencyMarkers(mobileDir: string): string[] {
  return MOBILE_TYPECHECK_DEPENDENCY_MARKERS.filter((marker) => !existsSync(join(mobileDir, marker)));
}

function listStagedPathChanges(projectDir: string, pathspec: string): string[] {
  const result = spawnSync(
    "git",
    ["diff", "--cached", "--name-only", "--", pathspec],
    {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    const reason = result.stderr.trim() || result.stdout.trim() || `git exited ${result.status}`;
    throw new Error(`Cannot inspect staged ${pathspec} changes: ${reason}`);
  }
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

export async function checkMacosSwiftBuild(
  projectDir: string,
  options: RepairCheckOptions = {},
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

function hasPackageProject(projectDir: string): boolean {
  return PACKAGE_PROJECT_MARKERS.some((marker) => existsSync(join(projectDir, marker)));
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
