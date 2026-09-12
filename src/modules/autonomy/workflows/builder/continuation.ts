import { join } from "node:path";
import { readAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { resolveAgentRunDirFromContext } from "#core/workflow/agent-run-dir.js";
import type { WorkflowRepairLoopConfig } from "#core/workflow/run-types.js";
import { autonomyContinuationPolicy } from "#modules/autonomy/continuation.js";
import { verifyBuilderTaskSnapshot } from "./task-contract.js";

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
