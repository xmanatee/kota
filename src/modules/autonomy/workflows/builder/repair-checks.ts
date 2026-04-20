import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRepairCheck } from "#core/workflow/run-types.js";
import { createCriticCheck } from "#modules/autonomy/critic.js";
import { checkCommitMessageExists, checkNoScratchArtifacts, runCheck } from "#modules/autonomy/shared.js";
import { findTaskReviewTarget } from "#modules/autonomy/task-review-target.js";

function countDoneWhenItems(taskContent: string): number {
  const doneWhenMatch = taskContent.match(/## Done When\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
  if (!doneWhenMatch) return 0;
  return doneWhenMatch[1].split("\n").filter((l) => /^\s*-\s+\S/.test(l)).length;
}

// A "top-level" criterion/evidence item is a numbered marker at column 0
// (`1.`, `2)`). Bullets (`-`, `*`) are treated as prose/notes so agents can
// add "Design notes" or "Known limitations" sections without inflating the
// criterion count. Six failures in 7d (hjpmjs, vxjzg3, qno619, and three
// earlier) all had the same shape: numbered criteria followed by a notes
// section with column-0 dashes, which the prior regex counted as extra
// criteria and forced evidence-file padding during repair.
function countTopLevelItems(text: string): number {
  return text.split("\n").filter((line) => /^\d+[.)]\s+\S/.test(line)).length;
}

function countNonEmptyLines(text: string): number {
  return text.split("\n").filter((l) => l.trim().length > 0).length;
}

export function checkSuccessCriteriaDeclared(runDirPath: string, projectDir?: string): string {
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

  let minCriteria = 2;
  if (projectDir) {
    const task = findTaskReviewTarget(projectDir);
    if (task) {
      const doneWhenCount = countDoneWhenItems(task.content);
      if (doneWhenCount > 0) minCriteria = doneWhenCount;
    }
  }

  if (lines.length < minCriteria) {
    throw new Error(
      `success-criteria.txt must contain at least ${minCriteria} concrete criteria ` +
        `(matching the task's Done When items). Found ${lines.length} non-empty line(s).`,
    );
  }

  return `OK: success-criteria.txt has ${lines.length} criteria (minimum ${minCriteria})`;
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
  const criteria = readFileSync(criteriaPath, "utf8");
  const verified = readFileSync(verifiedPath, "utf8");

  // When criteria are written as numbered items, compare numbered-item counts.
  // Bullets and prose are treated as notes and do not count as criteria, so
  // agents can freely add "Design notes" or "Known limitations" sections
  // without padding evidence to match. Fall back to non-empty line counts
  // only when neither file uses numbered items.
  const criteriaItems = countTopLevelItems(criteria);
  const verifiedItems = countTopLevelItems(verified);
  const useStructured = criteriaItems > 0 || verifiedItems > 0;
  const criteriaCount = useStructured ? criteriaItems : countNonEmptyLines(criteria);
  const verifiedCount = useStructured ? verifiedItems : countNonEmptyLines(verified);
  const unit = useStructured ? "numbered evidence item" : "evidence line";

  if (verifiedCount < criteriaCount) {
    const guidance = useStructured
      ? "Each criterion must be addressed with one numbered evidence item " +
        '(a line starting with "1.", "2.", etc. at column 0). Bullets and ' +
        "prose under a criterion are treated as notes and do not count separately."
      : "Each criterion must be addressed with a corresponding evidence line.";
    throw new Error(
      `success-criteria-verified.txt has ${verifiedCount} ${unit}(s) ` +
        `but success-criteria.txt declares ${criteriaCount} criteria. ${guidance}`,
    );
  }
  return `OK: success criteria verified (${verifiedCount} ${unit}s for ${criteriaCount} criteria)`;
}

/**
 * Approved root src/*.ts production files. New capabilities belong in
 * src/core/ or src/modules/, not here. Update this set only when
 * intentionally adding a root entrypoint or thin glue file.
 */
export const ROOT_PRODUCTION_ALLOWLIST = new Set([
  "cli.ts",
  "init.ts",
  "module-api.ts",
  "validate-queue.ts",
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

export function builderRepairChecks(): WorkflowRepairCheck[] {
  return [
    {
      id: "success-criteria-declared",
      type: "code" as const,
      run: (ctx) => checkSuccessCriteriaDeclared(ctx.workflow.runDirPath, ctx.projectDir),
    },
    {
      id: "success-criteria-verified",
      type: "code" as const,
      phase: 1,
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
      phase: 1,
      run: (ctx) => runCheck("pnpm run validate-tasks", ctx.projectDir),
    },
    {
      id: "typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => runCheck("pnpm run typecheck", ctx.projectDir),
    },
    {
      id: "lint",
      type: "code" as const,
      phase: 1,
      run: (ctx) => runCheck("pnpm run lint:fix && git add -u && pnpm run lint", ctx.projectDir),
    },
    {
      id: "test",
      type: "code" as const,
      phase: 1,
      run: (ctx) => runCheck("pnpm test", ctx.projectDir, 300_000),
    },
    {
      id: "mobile-typecheck",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMobileTypecheck(ctx.projectDir),
    },
    {
      id: "macos-swift-build",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkMacosSwiftBuild(ctx.projectDir),
    },
    {
      id: "module-boundary",
      type: "code" as const,
      phase: 1,
      run: (ctx) => checkModuleBoundary(ctx.projectDir),
    },
    {
      id: "no-scratch-artifacts",
      type: "code" as const,
      run: (ctx) => checkNoScratchArtifacts(ctx.projectDir),
    },
    {
      id: "commit-message-exists",
      type: "code" as const,
      run: (ctx) => checkCommitMessageExists(ctx.workflow.runDirPath, ctx.projectDir),
    },
    { ...createCriticCheck(), phase: 2 },
  ];
}
