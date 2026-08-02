import { join, relative } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { ensureDir, formatRunId, writeJsonFile } from "#core/workflow/run-io.js";
import type { WorkflowTrialAttemptReport, WorkflowTrialSummary } from "../client.js";
import { runTrialAttempt } from "./trial-attempt.js";
import type { RunWorkflowTrialArgs } from "./trial-internal-types.js";
import {
  buildTrialVariants,
  normalizeTrialRepeat,
  projectTrialPayload,
} from "./trial-options.js";

export async function runWorkflowTrial(
  args: RunWorkflowTrialArgs,
): Promise<WorkflowTrialSummary> {
  const repeat = normalizeTrialRepeat(args.options?.repeat);
  const variants = buildTrialVariants(args.workflowName, args.options);
  const runId = formatRunId(`${args.workflowName}-trial-report`);
  const reportDirPath = join(args.sourceProjectDir, ".kota", "runs", runId, "workflow-trial");
  ensureDir(reportDirPath);

  const attempts: WorkflowTrialAttemptReport[] = [];
  for (const variant of variants) {
    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex++) {
      attempts.push(await runTrialAttempt({
        sourceProjectDir: args.sourceProjectDir,
        reportDirPath,
        variant,
        repeatIndex,
        runtimeFactory: args.runtimeFactory,
      }));
    }
  }

  const passed = attempts.filter((attempt) => attempt.status === "passed").length;
  const failed = attempts.filter((attempt) => attempt.status === "failed").length;
  const blocked = attempts.filter((attempt) => attempt.status === "blocked").length;
  const summary: WorkflowTrialSummary = {
    runId,
    workflow: args.workflowName,
    projectId: args.options?.projectId ?? deriveDirectoryScopeId(args.sourceProjectDir),
    sourceProjectPath: args.sourceProjectDir,
    reportDir: relative(args.sourceProjectDir, reportDirPath),
    payload: projectTrialPayload(args.options?.payload ?? {}),
    repeat,
    attempts,
    comparison: {
      workflows: args.options?.compareWorkflows ?? [],
      payloadVariants: (args.options?.comparePayloads ?? []).map(projectTrialPayload),
    },
    passed,
    failed,
    blocked,
    status: failed === 0 && blocked === 0 ? "passed" : "failed",
  };
  writeJsonFile(join(reportDirPath, "summary.json"), summary);
  return summary;
}
