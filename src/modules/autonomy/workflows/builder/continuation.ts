import { join } from "node:path";
import { readAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import type { WorkflowContinuationContext } from "#core/workflow/continuation.js";
import type { WorkflowRepairLoopConfig } from "#core/workflow/run-types.js";
import {
  autonomyContinuationPolicy,
  collectAutonomyContinuationContext,
} from "#modules/autonomy/continuation.js";
import type { RepoTaskPriority } from "#modules/repo-tasks/repo-tasks-domain.js";
import { verifyBuilderTaskSnapshot } from "./task-contract.js";

type BuilderContinuationContextInput = Readonly<{
  scopeRoot: string;
  taskId: string;
  priority: string;
  taskContract: string;
}>;

function readPriority(priority: string): RepoTaskPriority {
  if (
    priority !== "p0" &&
    priority !== "p1" &&
    priority !== "p2" &&
    priority !== "p3"
  ) {
    throw new Error(`Unknown continuation priority "${priority}"`);
  }
  return priority;
}

export function collectBuilderContinuationContext(
  input: BuilderContinuationContextInput,
): WorkflowContinuationContext {
  return collectAutonomyContinuationContext({
    scopeRoot: input.scopeRoot,
    id: input.taskId,
    priority: readPriority(input.priority),
    taskContract: input.taskContract,
  });
}

export function builderContinuationPolicy(): NonNullable<
  WorkflowRepairLoopConfig["continuation"]
> {
  return autonomyContinuationPolicy({
    decompositionSupported: true,
    resolveSubject: (ctx) => {
      const agentDir = resolveAgentRunDirFromContext(ctx);
      const snapshot = readAnchoredTextFile({
        rootPath: agentDir,
        boundaryDir: agentDir,
        filePath: join(agentDir, "admitted-task.md"),
      });
      if (snapshot === null) throw new Error("Builder continuation requires its admitted task snapshot");
      const task = verifyBuilderTaskSnapshot(ctx.trigger.payload, snapshot.content);
      return {
        id: task.taskId,
        priority: task.priority,
        taskContract: snapshot.content,
      };
    },
  });
}
