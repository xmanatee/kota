import { readFileSync } from "node:fs";
import type { Command } from "commander";
import type { EventEnvelope } from "#core/events/event-journal.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { printWorkflowError, printWorkflowText } from "../cli-output.js";
import { getValidatedWorkflowDefinitions } from "../definitions-source.js";
import { simulateAutomation } from "./engine.js";
import {
  getSimulationFixture,
  SIMULATION_FIXTURES,
} from "./fixtures.js";
import { formatWorkflowSimulationResult } from "./format.js";
import type {
  WorkflowSimulationJournalSelector,
  WorkflowSimulationRequest,
  WorkflowSimulationResult,
} from "./types.js";

type ParsedJson = ReturnType<typeof JSON.parse>;

type EnvelopeCandidate = {
  id?: string;
  event?: {
    name?: string;
  };
};

type SimulationCliOptions = {
  event?: string;
  payload?: string;
  payloadFile?: string;
  eventId?: string;
  envelope?: string;
  journalId?: string;
  journalAfter?: string;
  journalType?: string;
  journalTypePrefix?: string;
  journalLimit?: string;
  fixture?: string;
  listFixtures?: boolean;
  format: string;
};

function parseJsonObject(raw: string, label: string): WorkflowRunTrigger["payload"] {
  let parsed: ParsedJson;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as WorkflowRunTrigger["payload"];
}

function parseEnvelope(path: string): EventEnvelope {
  let parsed: ParsedJson;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(`--envelope could not be read as JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof (parsed as EnvelopeCandidate).id !== "string" ||
    typeof (parsed as EnvelopeCandidate).event?.name !== "string"
  ) {
    throw new Error("--envelope must point to a durable EventEnvelope JSON object");
  }
  return parsed as EventEnvelope;
}

function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("--journal-limit must be a positive integer");
  }
  return Math.min(parsed, 100);
}

function payloadFromOptions(opts: SimulationCliOptions): WorkflowRunTrigger["payload"] | undefined {
  if (opts.payload !== undefined && opts.payloadFile !== undefined) {
    throw new Error("Use either --payload or --payload-file, not both");
  }
  if (opts.payload !== undefined) return parseJsonObject(opts.payload, "--payload");
  if (opts.payloadFile !== undefined) {
    return parseJsonObject(readFileSync(opts.payloadFile, "utf-8"), "--payload-file");
  }
  return undefined;
}

function journalFromOptions(
  opts: SimulationCliOptions,
): WorkflowSimulationJournalSelector | undefined {
  const hasJournal =
    opts.journalId !== undefined ||
    opts.journalAfter !== undefined ||
    opts.journalType !== undefined ||
    opts.journalTypePrefix !== undefined ||
    opts.journalLimit !== undefined;
  if (!hasJournal) return undefined;
  return {
    ...(opts.journalId ? { id: opts.journalId } : {}),
    ...(opts.journalAfter ? { after: opts.journalAfter } : {}),
    ...(opts.journalType ? { type: opts.journalType } : {}),
    ...(opts.journalTypePrefix ? { typePrefix: opts.journalTypePrefix } : {}),
    ...(opts.journalLimit ? { limit: parseLimit(opts.journalLimit) } : {}),
  };
}

function requestFromOptions(
  workflow: string | undefined,
  opts: SimulationCliOptions,
): WorkflowSimulationRequest {
  if (opts.fixture) {
    const fixture = getSimulationFixture(opts.fixture);
    if (!fixture) {
      throw new Error(`Unknown simulation fixture "${opts.fixture}"`);
    }
    return {
      ...fixture.request,
      ...(workflow ? { workflowName: workflow } : {}),
    };
  }
  const journal = journalFromOptions(opts);
  if (opts.envelope !== undefined) {
    return {
      ...(workflow ? { workflowName: workflow } : {}),
      envelope: parseEnvelope(opts.envelope),
    };
  }
  if (journal !== undefined) {
    return {
      ...(workflow ? { workflowName: workflow } : {}),
      journal,
    };
  }
  if (!opts.event) {
    throw new Error("workflow simulation requires --event, --envelope, --journal-id, --journal-after, or --fixture");
  }
  return {
    ...(workflow ? { workflowName: workflow } : {}),
    event: opts.event,
    payload: payloadFromOptions(opts) ?? {},
    ...(opts.eventId ? { eventId: opts.eventId } : {}),
  };
}

function printFixtures(): void {
  printWorkflowText("Simulation fixtures:");
  for (const fixture of SIMULATION_FIXTURES) {
    printWorkflowText(`  ${fixture.name} - ${fixture.description}`);
  }
}

function isDaemonUnreachable(err: Error): boolean {
  return err.message.includes("Daemon unreachable");
}

function runLocalSimulation(
  ctx: ModuleContext,
  request: WorkflowSimulationRequest,
) {
  const moduleManifests = typeof ctx.getModuleSummaries === "function"
    ? ctx.getModuleSummaries().flatMap((summary) =>
        summary.manifest ? [summary.manifest] : []
      )
    : [];
  const toolNames = typeof ctx.listTools === "function" ? ctx.listTools() : [];
  return simulateAutomation({
    projectDir: ctx.cwd,
    definitions: getValidatedWorkflowDefinitions(ctx, ctx.cwd),
    moduleManifests,
    availableToolNames: new Set(toolNames),
    request,
  });
}

export function registerSimulationCommand(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
  wfCmd
    .command("simulate [workflow]")
    .description("Preview event-driven automation without live side effects")
    .option("--event <event>", "Synthetic event type to simulate")
    .option("--payload <json>", "Synthetic event payload JSON object")
    .option("--payload-file <path>", "Read synthetic event payload JSON object from a file")
    .option("--event-id <id>", "Durable event id to include in the synthetic sample")
    .option("--envelope <path>", "Read a durable EventEnvelope JSON object from a file")
    .option("--journal-id <id>", "Replay one durable event journal id")
    .option("--journal-after <id>", "Replay journal events after this id")
    .option("--journal-type <event>", "Filter journal replay by exact event type")
    .option("--journal-type-prefix <prefix>", "Filter journal replay by event type prefix")
    .option("--journal-limit <n>", "Maximum journal events to replay")
    .option("--fixture <name>", "Run a committed simulation fixture")
    .option("--list-fixtures", "List committed simulation fixtures")
    .option("--format <format>", "Output format: text (default) or json", "text")
    .action(async (
      workflow: string | undefined,
      opts: SimulationCliOptions,
    ) => {
      if (opts.listFixtures) {
        printFixtures();
        return;
      }
      let request: WorkflowSimulationRequest;
      try {
        request = requestFromOptions(workflow, opts);
      } catch (err) {
        printWorkflowError(err instanceof Error ? err.message : String(err));
        process.exit(1);
        return;
      }
      let result: WorkflowSimulationResult;
      try {
        result = await ctx.client.workflow.simulate(request);
      } catch (err) {
        if (!(err instanceof Error) || !isDaemonUnreachable(err)) {
          printWorkflowError(err instanceof Error ? err.message : String(err));
          process.exit(1);
          return;
        }
        result = await runLocalSimulation(ctx, request);
      }
      switch (opts.format) {
        case "text":
          printWorkflowText(formatWorkflowSimulationResult(result));
          break;
        case "json":
          printWorkflowText(JSON.stringify(result, null, 2));
          break;
        default:
          printWorkflowError('Unknown format. Use "text" or "json".');
          process.exit(1);
      }
    });
}
