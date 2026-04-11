import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { runCheck } from "#modules/autonomy/shared.js";

export function checkSuccessCriteriaDeclared(runDirPath: string): string {
  const filePath = join(runDirPath, "success-criteria.txt");
  if (!existsSync(filePath)) {
    throw new Error(
      "Missing success-criteria.txt in the run directory. " +
        "Before implementing, write a short list of concrete, verifiable " +
        "success conditions to <run-directory>/success-criteria.txt.",
    );
  }
  const content = readFileSync(filePath, "utf8").trim();
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error(
      "success-criteria.txt must contain at least 2 concrete criteria. " +
        `Found ${lines.length} non-empty line(s).`,
    );
  }
  return `OK: success-criteria.txt has ${lines.length} criteria`;
}

export function checkSuccessCriteriaVerified(runDirPath: string): string {
  const criteriaPath = join(runDirPath, "success-criteria.txt");
  const verifiedPath = join(runDirPath, "success-criteria-verified.txt");
  if (!existsSync(criteriaPath)) {
    throw new Error("Cannot verify criteria: success-criteria.txt does not exist.");
  }
  if (!existsSync(verifiedPath)) {
    throw new Error(
      "Missing success-criteria-verified.txt in the run directory. " +
        "After implementation, write this file confirming each declared criterion " +
        "is satisfied with evidence.",
    );
  }
  const criteria = readFileSync(criteriaPath, "utf8").trim();
  const verified = readFileSync(verifiedPath, "utf8").trim();
  if (verified.length < criteria.length / 2) {
    throw new Error(
      "success-criteria-verified.txt appears too short relative to the declared criteria. " +
        "Each criterion must be addressed with evidence.",
    );
  }
  return "OK: success criteria declared and verified";
}

/**
 * Approved root src/*.ts production files. New capabilities belong in
 * src/core/ or src/modules/, not here. Update this set only when
 * intentionally adding a root entrypoint or thin glue file.
 */
export const ROOT_PRODUCTION_ALLOWLIST = new Set([
  "cli.ts",
  "cli-history.ts",
  "cli-history-commands.ts",
  "confirm.ts",
  "delegate-prompts.ts",
  "error-context.ts",
  "init.ts",
  "lint.ts",
  "module-api.ts",
  "path-resolver.ts",
  "project-detection.ts",
  "repl-session.ts",
  "validate-queue.ts",
  "workspace.ts",
]);

export function checkModuleBoundary(projectDir: string): string {
  const srcDir = join(projectDir, "src");
  if (!existsSync(srcDir)) return "OK: no src/ directory";

  // 1. Check for non-allowlisted production files in src/ root.
  const rootFiles = readdirSync(srcDir).filter(
    (f) => f.endsWith(".ts") && !f.includes(".test.") && !f.includes(".integration.") && !f.endsWith(".d.ts"),
  );
  const fileViolations = rootFiles.filter((f) => !ROOT_PRODUCTION_ALLOWLIST.has(f));
  if (fileViolations.length) {
    throw new Error(
      `Unexpected production files in src/ root: ${fileViolations.join(", ")}. ` +
        `New capabilities belong in src/core/ or src/modules/. ` +
        `If this file is intentional, add it to ROOT_PRODUCTION_ALLOWLIST in repair-checks.ts.`,
    );
  }

  // 2. Check for #root/* imports targeting non-allowlisted modules.
  const allowedImportTargets = new Set(
    [...ROOT_PRODUCTION_ALLOWLIST].map((f) => f.replace(/\.ts$/, ".js")),
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

type ImportViolation = { file: string; specifier: string };

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

function checkServerReadmeSync(projectDir: string): string {
  const candidates = [join(projectDir, "src/core/server"), join(projectDir, "src/server")];
  const serverDir = candidates.find((d) => existsSync(join(d, "README.md")));
  if (!serverDir) return "OK: no server README to check";
  const readme = readFileSync(join(serverDir, "README.md"), "utf8");
  const missing = readdirSync(serverDir)
    .filter((f) => f.endsWith("-routes.ts") && f !== "server-routes.ts")
    .filter((f) => !readme.includes(f));
  if (missing.length) {
    throw new Error(`Missing from server README.md: ${missing.join(", ")}`);
  }
  return "OK: server README covers all route files";
}

function checkMobileTypecheck(projectDir: string): string {
  const mobileDir = join(projectDir, "clients/mobile");
  if (!existsSync(join(mobileDir, "package.json"))) {
    return "OK: no mobile client present";
  }
  return runCheck("pnpm run typecheck", mobileDir, 60_000);
}

function checkMacosSwiftBuild(projectDir: string): string {
  const macosDir = join(projectDir, "clients/macos");
  if (!existsSync(join(macosDir, "Package.swift"))) {
    return "OK: no macOS client present";
  }
  return runCheck("swift build", macosDir, 120_000);
}

function checkDaemonApiDocSync(projectDir: string): string {
  const src = readFileSync(join(projectDir, "src/core/daemon/daemon-control.ts"), "utf8");
  const doc = readFileSync(join(projectDir, "docs/DAEMON-API.md"), "utf8");
  const routes = [...src.matchAll(/"(?:GET|POST|DELETE|PUT|PATCH) (\/[^"]+)":\s*"(?:read|control)"/g)].map(
    (m) => m[1],
  );
  const undocumented = [...new Set(routes)].filter((p) => !doc.includes(p));
  if (undocumented.length) {
    throw new Error(`Missing from docs/DAEMON-API.md: ${undocumented.join(", ")}`);
  }
  return "OK: DAEMON-API.md covers all daemon control routes";
}

export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
    {
      id: "success-criteria-declared",
      type: "code" as const,
      run: (ctx) => checkSuccessCriteriaDeclared(ctx.workflow.runDirPath),
    },
    {
      id: "success-criteria-verified",
      type: "code" as const,
      run: (ctx) => checkSuccessCriteriaVerified(ctx.workflow.runDirPath),
    },
    {
      id: "build-output",
      type: "code" as const,
      run: (ctx) => runCheck("pnpm build", ctx.projectDir),
    },
    {
      id: "task-queue-valid",
      type: "code" as const,
      run: (ctx) => runCheck("pnpm run validate-tasks", ctx.projectDir),
    },
    {
      id: "typecheck",
      type: "code" as const,
      run: (ctx) => runCheck("pnpm run typecheck", ctx.projectDir),
    },
    {
      id: "lint",
      type: "code" as const,
      run: (ctx) => runCheck("pnpm run lint", ctx.projectDir),
    },
    {
      id: "test",
      type: "code" as const,
      run: (ctx) => runCheck("pnpm test", ctx.projectDir, 300_000),
    },
    {
      id: "server-readme-sync",
      type: "code" as const,
      run: (ctx) => checkServerReadmeSync(ctx.projectDir),
    },
    {
      id: "mobile-typecheck",
      type: "code" as const,
      run: (ctx) => checkMobileTypecheck(ctx.projectDir),
    },
    {
      id: "macos-swift-build",
      type: "code" as const,
      run: (ctx) => checkMacosSwiftBuild(ctx.projectDir),
    },
    {
      id: "daemon-api-doc-sync",
      type: "code" as const,
      run: (ctx) => checkDaemonApiDocSync(ctx.projectDir),
    },
    {
      id: "module-boundary",
      type: "code" as const,
      run: (ctx) => checkModuleBoundary(ctx.projectDir),
    },
    createCriticCheck(),
  ];
}
