import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AgentDef } from "../../../../agent-types.js";
import type { RepoTaskQueueSnapshot } from "../../../../repo-tasks.js";
import { getRepoTaskQueueSnapshot } from "../../../../repo-tasks.js";
import { assertRepoWorktreeClean, getRepoHeadSha } from "../../../../repo-worktree.js";
import type { WorkflowDefinitionInput } from "../../../../workflow/types.js";
import { typedCodeStep } from "../../../../workflow/types.js";
import { commitWorkflowChanges } from "../../commit.js";
import { runCheck, stepCommitted, stepSucceeded } from "../../shared.js";
import type { BranchStepResult, CleanupResult } from "./branch-per-task.js";
import { cleanupMergedBranches, createPullRequest, createTaskBranch } from "./branch-per-task.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { writeBuilderRunSummary } from "./run-summary.js";

export function checkModuleBoundary(projectDir: string): string {
  const staged = execFileSync("git", ["diff", "--cached", "--name-status"], {
    cwd: projectDir,
    encoding: "utf8",
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

export const agent: AgentDef = {
  name: "builder",
  role: "Ship one cohesive improvement per run by resuming, pulling, or promoting one normalized task.",
  promptPath: "src/modules/autonomy/workflows/builder/prompt.md",
  model: "claude-sonnet-4-6",
  tools: { permissionMode: "bypassPermissions" },
  settingSources: ["project"],
};

const inspectReadyQueue = typedCodeStep<RepoTaskQueueSnapshot>({
  id: "inspect-ready-queue",
  type: "code",
  run: ({ projectDir }) => {
    assertRepoWorktreeClean(projectDir);
    return getRepoTaskQueueSnapshot(projectDir);
  },
});

const builderWorkflow: WorkflowDefinitionInput = {
  name: "builder",
  description: "Build KOTA by shipping one cohesive improvement per workflow run.",
  costAnomalyThreshold: 3,
  triggers: [
    {
      event: "autonomy.queue.available",
    },
  ],
  steps: [
    inspectReadyQueue,
    {
      id: "build",
      type: "agent",
      agentName: agent.name,
      promptPath: agent.promptPath,
      model: agent.model,
      permissionMode: agent.tools?.permissionMode,
      settingSources: agent.settingSources,
      timeoutMs: 60 * 60 * 1000, // 60 minutes — builder runs can be long
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectReadyQueue.output(ctx).pullableCount > 0,
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [
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
            run: (ctx) => {
              const serverDir = join(ctx.projectDir, "src/server");
              const readme = readFileSync(join(serverDir, "README.md"), "utf8");
              const missing = readdirSync(serverDir)
                .filter((f) => f.endsWith("-routes.ts") && f !== "server-routes.ts")
                .filter((f) => !readme.includes(f));
              if (missing.length) {
                throw new Error(`Missing from src/server/README.md: ${missing.join(", ")}`);
              }
              return "OK: server README covers all route files";
            },
          },
          {
            id: "mobile-typecheck",
            type: "code" as const,
            run: (ctx) => {
              const mobileDir = join(ctx.projectDir, "clients/mobile");
              if (!existsSync(join(mobileDir, "package.json"))) {
                return "OK: no mobile client present";
              }
              return runCheck("pnpm run typecheck", mobileDir, 60_000);
            },
          },
          {
            id: "macos-swift-build",
            type: "code" as const,
            run: (ctx) => {
              const macosDir = join(ctx.projectDir, "clients/macos");
              if (!existsSync(join(macosDir, "Package.swift"))) {
                return "OK: no macOS client present";
              }
              return runCheck("swift build", macosDir, 120_000);
            },
          },
          {
            id: "daemon-api-doc-sync",
            type: "code" as const,
            run: (ctx) => {
              const src = readFileSync(join(ctx.projectDir, "src/scheduler/daemon-control.ts"), "utf8");
              const doc = readFileSync(join(ctx.projectDir, "docs/DAEMON-API.md"), "utf8");
              const routes = [...src.matchAll(/"(?:GET|POST|DELETE|PUT|PATCH) (\/[^"]+)":\s*"(?:read|control)"/g)].map((m) => m[1]);
              const undocumented = [...new Set(routes)].filter((p) => !doc.includes(p));
              if (undocumented.length) {
                throw new Error(`Missing from docs/DAEMON-API.md: ${undocumented.join(", ")}`);
              }
              return "OK: DAEMON-API.md covers all daemon control routes";
            },
          },
          {
            id: "module-boundary",
            type: "code" as const,
            run: (ctx) => checkModuleBoundary(ctx.projectDir),
          },
          {
            id: "src-agents-md-key-modules",
            type: "code" as const,
            run: (ctx) => {
              const staged = execFileSync("git", ["diff", "--cached", "--name-status"], {
                cwd: ctx.projectDir,
                encoding: "utf8",
              });
              const newFiles = staged
                .split("\n")
                .filter((l) => l.startsWith("A\t"))
                .map((l) => l.slice(2).trim())
                .filter(
                  (f) =>
                    /^src\/[^/]+\.ts$/.test(f) &&
                    !f.includes(".test.") &&
                    !f.endsWith("/index.ts") &&
                    !f.endsWith("/testing-api.ts"),
                );
              if (!newFiles.length) return "OK: no new public src/ modules to check";
              const agentsMd = readFileSync(join(ctx.projectDir, "src/AGENTS.md"), "utf8");
              const missing = newFiles.filter((f) => !agentsMd.includes(`\`${basename(f, ".ts")}.ts\``));
              if (missing.length) {
                throw new Error(
                  `New src/ modules not documented in src/AGENTS.md Key Modules: ${missing.join(", ")}`,
                );
              }
              return "OK: all new src/ modules in src/AGENTS.md Key Modules";
            },
          },
        ],
      },
    },
    {
      id: "check-no-intermediate-commits",
      type: "code",
      when: stepSucceeded("build"),
      run: (ctx) => {
        const startSha = inspectReadyQueue.output(ctx).headSha;
        const currentSha = getRepoHeadSha(ctx.projectDir);
        if (startSha && currentSha && startSha !== currentSha) {
          throw new Error(
            `Builder agent committed directly during its run (${startSha.slice(0, 8)} → ${currentSha.slice(0, 8)}), bypassing the validation gate. ` +
              `Intermediate commits circumvent the repair loop and must not occur. ` +
              `The prompt instructs: stage changes and write commit-message.txt — never run git commit.`,
          );
        }
        return { startSha, currentSha, clean: startSha === currentSha };
      },
    },
    typedCodeStep<BranchStepResult>({
      id: "create-task-branch",
      type: "code",
      when: stepSucceeded("check-no-intermediate-commits"),
      run: (ctx) => createTaskBranch(ctx),
    }),
    {
      id: "commit",
      type: "code",
      when: stepSucceeded("create-task-branch"),
      run: ({ projectDir, workflow }) => commitWorkflowChanges(projectDir, workflow.runDirPath),
    },
    typedCodeStep<BuilderRunSummary>({
      id: "write-run-summary",
      type: "code",
      when: stepCommitted("commit"),
      run: (ctx) => writeBuilderRunSummary(ctx),
    }),
    {
      id: "create-pr",
      type: "code",
      when: (ctx) => {
        if (!stepCommitted("commit")(ctx)) return false;
        const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
        return branchInfo?.branchPerTask === true;
      },
      run: (ctx) => createPullRequest(ctx),
    },
    typedCodeStep<CleanupResult>({
      id: "cleanup-merged-branches",
      type: "code",
      when: (ctx) => {
        const branchInfo = ctx.stepOutputs["create-task-branch"] as BranchStepResult | undefined;
        return branchInfo?.branchPerTask === true;
      },
      run: (ctx) => cleanupMergedBranches(ctx),
    }),
    {
      id: "emit-build-committed",
      type: "emit",
      when: stepSucceeded("write-run-summary"),
      event: "workflow.build.committed",
      payload: (ctx) => {
        const summary = ctx.stepOutputs["write-run-summary"] as BuilderRunSummary | undefined;
        return {
          runId: ctx.workflow.runId,
          taskId: summary?.taskId ?? null,
          commitMessage: summary?.commitMessage ?? "",
          costUsd: summary?.costUsd ?? null,
          durationMs: summary?.durationMs ?? null,
        };
      },
    },
    {
      id: "request-restart",
      type: "restart",
      when: stepCommitted("commit"),
      reason: "builder workflow finished validation and commit",
      requires: ["commit"],
    },
  ],
};

export default builderWorkflow;
