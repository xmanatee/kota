import type { RepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { getRepoTaskQueueSnapshot } from "../../repo-tasks.js";
import { assertRepoWorktreeClean, getRepoHeadSha } from "../../repo-worktree.js";
import type { WorkflowDefinitionInput } from "../../workflow/types.js";
import { typedCodeStep } from "../../workflow/types.js";
import { commitWorkflowChanges } from "../commit.js";
import { runCheck, stepCommitted, stepSucceeded } from "../shared.js";
import type { BranchStepResult } from "./branch-per-task.js";
import { createPullRequest, createTaskBranch } from "./branch-per-task.js";
import type { BuilderRunSummary } from "./run-summary.js";
import { writeBuilderRunSummary } from "./run-summary.js";

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
  triggers: [
    {
      event: "workflow.completed",
      filter: {
        workflow: "explorer",
        status: "success",
      },
    },
  ],
  steps: [
    inspectReadyQueue,
    {
      id: "build",
      type: "agent",
      agentName: "builder",
      timeoutMs: 60 * 60 * 1000, // 60 minutes — builder runs can be long
      retry: { maxAttempts: 2, initialDelayMs: 5000, backoffFactor: 2 },
      when: (ctx) => inspectReadyQueue.output(ctx).actionableCount > 0,
      repairLoop: {
        maxRepairAttempts: 3,
        checks: [
          {
            id: "build-output",
            type: "code" as const,
            run: (ctx) => runCheck("npm run build", ctx.projectDir),
          },
          {
            id: "task-queue-valid",
            type: "code" as const,
            run: (ctx) => runCheck("npm run validate-tasks", ctx.projectDir),
          },
          {
            id: "typecheck",
            type: "code" as const,
            run: (ctx) => runCheck("npm run typecheck", ctx.projectDir),
          },
          {
            id: "lint",
            type: "code" as const,
            run: (ctx) => runCheck("npm run lint", ctx.projectDir),
          },
          {
            id: "test",
            type: "code" as const,
            run: (ctx) => runCheck("npm test", ctx.projectDir, 300_000),
          },
          {
            id: "server-readme-sync",
            type: "code" as const,
            run: (ctx) =>
              runCheck(
                `node -e "const fs=require('fs'),path=require('path'),d=path.join(process.cwd(),'src/server');` +
                  `const r=fs.readFileSync(path.join(d,'README.md'),'utf8');` +
                  `const m=fs.readdirSync(d).filter(f=>f.endsWith('-routes.ts')&&f!=='server-routes.ts').filter(f=>!r.includes(f));` +
                  `if(m.length){console.error('Missing from src/server/README.md: '+m.join(', '));process.exit(1);}` +
                  `console.log('OK: server README covers all route files');"`,
                ctx.projectDir,
              ),
          },
          {
            id: "daemon-api-doc-sync",
            type: "code" as const,
            run: (ctx) =>
              runCheck(
                `node -e "const fs=require('fs'),path=require('path');` +
                  `const src=fs.readFileSync(path.join(process.cwd(),'src/server/server-routes.ts'),'utf8');` +
                  `const doc=fs.readFileSync(path.join(process.cwd(),'docs/DAEMON-API.md'),'utf8');` +
                  `const webUiOnly=new Set(['/api/sessions','/api/chat','/api/schedules','/api/notifications']);` +
                  `const paths=[...src.matchAll(/path\\s*===\\s*\\x22(\\/api\\/[^\\x22]+)\\x22/g)].map(m=>m[1]).filter(p=>!webUiOnly.has(p));` +
                  `const undocumented=[...new Set(paths)].filter(p=>!doc.includes(p));` +
                  `if(undocumented.length){console.error('Missing from docs/DAEMON-API.md: '+undocumented.join(', '));process.exit(1);}` +
                  `console.log('OK: DAEMON-API.md covers all /api/ paths in server-routes.ts');"`,
                ctx.projectDir,
              ),
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
