import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  blank,
  json,
  line,
  plain,
  type RenderNode,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { statusIcon } from "../utils.js";
import {
  buildChainTree,
  fetchRunSummary,
  printChainTree,
} from "./run-show-chain.js";
import {
  buildRunHeader,
  buildStepSpans,
  errorSpans,
  formatWarningsSection,
} from "./run-show-render.js";

export type { ChainNode } from "./run-show-chain.js";
export {
  buildChainNode,
  printChainTree,
} from "./run-show-chain.js";
export {
  formatRepairLine,
  formatSkipReason,
  formatWarningsSection,
} from "./run-show-render.js";

/** Project a daemon detail onto the metadata shape consumed by CLI rendering. */
function metadataFromDetail(run: WorkflowRunDetail): WorkflowRunMetadata {
  return {
    id: run.id,
    workflow: run.workflow,
    definitionPath: "",
    trigger: {
      event: run.triggerEvent,
      schemaRef: run.triggerSchemaRef,
      payload: run.triggerPayload ?? {},
    },
    startedAt: run.startedAt,
    status: run.status as WorkflowRunMetadata["status"],
    runDir: "",
    steps: run.steps.map((step) => ({
      id: step.id,
      type: step.type as WorkflowRunMetadata["steps"][number]["type"],
      status: step.status as WorkflowRunMetadata["steps"][number]["status"],
      startedAt: run.startedAt,
      completedAt: run.completedAt ?? run.startedAt,
      durationMs: step.durationMs,
      ...(step.error !== undefined && { error: step.error }),
      ...(step.costUsd != null && {
        costUsd: step.costUsd,
        output: { totalCostUsd: step.costUsd },
      }),
      ...(step.skipReason !== undefined && { skipReason: step.skipReason }),
    })),
    ...(run.completedAt != null && { completedAt: run.completedAt }),
    ...(run.durationMs != null && { durationMs: run.durationMs }),
    ...(run.totalCostUsd != null && { totalCostUsd: run.totalCostUsd }),
    ...(run.triggeredByRunId != null && { triggeredByRunId: run.triggeredByRunId }),
    ...(run.causedBy != null && { causedBy: run.causedBy }),
    ...(run.retryOf != null && { retryOf: run.retryOf }),
    ...(run.resumedFromRunId != null && { resumedFromRunId: run.resumedFromRunId }),
    ...(run.warnings && run.warnings.length > 0 && { warnings: run.warnings }),
  };
}

export function registerRunShowCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("show <run-id>")
    .description("Show step-level details for a specific run")
    .option("--step <step-id>", "Print the full output of a specific step as JSON")
    .option("--payload", "Print the trigger payload as formatted JSON")
    .option("--chain", "Print the full causal chain tree (max 5 levels deep)")
    .action(async (runId, options) => {
      const stepId = options.step as string | undefined;
      const showPayload = options.payload as boolean | undefined;
      const showChain = options.chain as boolean | undefined;
      const store = new WorkflowRunStore();

      let resolvedId = runId;
      if (!runId.includes("Z-")) {
        try {
          const dirs = readdirSync(store.runsDir).sort().reverse();
          const match = dirs.find((directory) => directory.startsWith(runId));
          if (!match) {
            print(line(...errorSpans(`Run "${runId}" not found.`)));
            process.exit(1);
          }
          resolvedId = match;
        } catch {
          print(line(...errorSpans(`Run "${runId}" not found.`)));
          process.exit(1);
        }
      }

      let metadata: WorkflowRunMetadata;
      if (stepId !== undefined) {
        const diskMetadata = store.getRun(resolvedId);
        if (!diskMetadata) {
          print(line(...errorSpans(`Run "${resolvedId}" not found.`)));
          process.exit(1);
        }
        metadata = diskMetadata;
      } else {
        const result = await ctx.client.workflow.getRun(resolvedId);
        if (!result.found) {
          print(line(...errorSpans(`Run "${resolvedId}" not found.`)));
          process.exit(1);
        }
        metadata = metadataFromDetail(result.run);
      }

      if (stepId !== undefined) {
        const step = metadata.steps.find((candidate) => candidate.id === stepId);
        if (!step) {
          print(line(...errorSpans(`Step "${stepId}" not found in run "${resolvedId}".`)));
          process.exit(1);
        }
        print(step.error ? line(plain(step.error)) : json(step.output));
        return;
      }

      if (showChain) {
        const maxDepth = 5;
        let rootId = resolvedId;
        let current: { causedBy?: { runId: string; workflow: string } } | null = metadata;
        let depth = 0;
        while (current?.causedBy && depth < maxDepth) {
          const parent = await fetchRunSummary(ctx.client.workflow, current.causedBy.runId);
          if (!parent) break;
          rootId = parent.id;
          current = parent;
          depth++;
        }
        const tree = await buildChainTree(rootId, ctx.client.workflow, 0, maxDepth);
        if (!tree) {
          print(line(...errorSpans(`Could not load chain for run "${resolvedId}".`)));
          process.exit(1);
        }
        printChainTree(tree, resolvedId);
        return;
      }

      const errorPath = join(store.runsDir, resolvedId, "error.txt");
      const errorText = existsSync(errorPath) ? readFileSync(errorPath, "utf-8") : null;
      const children: RenderNode[] = [buildRunHeader(metadata, showPayload === true)];
      if (errorText !== null) {
        children.push(blank(), line(plain("Error:")));
        for (const errorLine of errorText.split("\n")) {
          children.push(line(plain(errorLine)));
        }
      }
      if (metadata.warnings && metadata.warnings.length > 0) {
        children.push(blank(), line(plain("Warnings:")));
        for (const warningLine of formatWarningsSection(metadata.warnings)) {
          children.push(line(plain(warningLine)));
        }
      }

      const downstream = await ctx.client.workflow.listRuns({
        causedByRunId: resolvedId,
        limit: 50,
      });
      const triggeredRuns = downstream.runs.map((run) => ({
        id: run.id,
        workflow: run.workflow,
        status: run.status,
      }));
      if (triggeredRuns.length > 0) {
        children.push(blank(), line(plain(`Triggered runs (${triggeredRuns.length}):`)));
        for (const run of triggeredRuns) {
          children.push(line(plain(`  ${statusIcon(run.status)} ${run.id} [${run.workflow}]`)));
        }
      }

      if (metadata.steps.length > 0) {
        children.push(blank(), line(plain(`Steps (${metadata.steps.length}):`)));
        for (const step of metadata.steps) {
          const { header, detail } = buildStepSpans(step);
          children.push(header, ...detail);
        }
      }
      print(stack(...children));
    });
}
