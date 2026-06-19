import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import { formatAutomationExplainResult } from "../graph/index.js";

type ParsedJson = ReturnType<typeof JSON.parse>;

function parsePayload(raw: string): WorkflowRunTrigger["payload"] {
  let parsed: ParsedJson;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("--payload must be valid JSON");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--payload must be a JSON object");
  }
  return parsed as WorkflowRunTrigger["payload"];
}

export function registerExplainCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("explain [workflow]")
    .description("Explain compiled automation matching for a workflow, event, or sample event payload")
    .option("--event <event>", "Event type to explain")
    .option("--payload <json>", "Sample event payload JSON object")
    .option("--event-id <id>", "Durable event id to include in the sample")
    .option("--format <format>", "Output format: text (default) or json", "text")
    .action(async (
      workflow: string | undefined,
      opts: { event?: string; payload?: string; eventId?: string; format: string },
    ) => {
      let payload: WorkflowRunTrigger["payload"] | undefined;
      if (opts.payload !== undefined) {
        try {
          payload = parsePayload(opts.payload);
        } catch (err) {
          printWorkflowError(err instanceof Error ? err.message : String(err));
          process.exit(1);
        }
      }
      if (payload !== undefined && !opts.event) {
        printWorkflowError("--payload requires --event");
        process.exit(1);
      }

      const result = await ctx.client.workflow.explain({
        ...(workflow ? { workflowName: workflow } : {}),
        ...(opts.event ? { eventName: opts.event } : {}),
        ...(opts.event && payload
          ? {
              sampleEvent: {
                event: opts.event,
                payload,
                ...(opts.eventId ? { eventId: opts.eventId } : {}),
              },
            }
          : {}),
      });

      switch (opts.format) {
        case "text":
          printWorkflowText(formatAutomationExplainResult(result));
          break;
        case "json":
          printWorkflowText(JSON.stringify(result, null, 2));
          break;
        default:
          printWorkflowError('Unknown format. Use "text" or "json".');
          process.exit(1);
      }

      if (result.outcome === "dead-letter") process.exitCode = 1;
    });
}
