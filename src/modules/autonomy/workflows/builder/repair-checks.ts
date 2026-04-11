import { execFileSync } from "node:child_process";
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

export function checkModuleBoundary(projectDir: string): string {
  const staged = execFileSync("git", ["diff", "--cached", "--name-status"], {
    cwd: projectDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const violations = staged
    .split("\n")
    .filter((l) => l.startsWith("A\t"))
    .map((l) => l.slice(2).trim())
    .filter((f) => /^src\/[^/]+\.ts$/.test(f) && !f.includes(".test.") && !f.endsWith(".d.ts"));
  if (violations.length) {
    throw new Error(
      `New capability files added to src/ root instead of src/modules/: ${violations.join(", ")}. ` +
        `New capabilities belong in src/modules/<name>/.`,
    );
  }
  return "OK: no new capability files in src/ root";
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
