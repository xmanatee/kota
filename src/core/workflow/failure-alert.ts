import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BusEvents } from "#core/events/event-bus.js";
import type { RegisteredWorkflowDefinitionInput } from "./types.js";

const FAILURE_ALERT_WORKFLOW = "workflow-failure-alert";
const FAILURE_ALERT_DEFINITION_PATH = "src/core/workflow/failure-alert.ts";
const MAX_ERROR_LENGTH = 300;

type WorkflowCompletion = BusEvents["workflow.completed"];

function readErrorFile(workspaceRoot: string, runDir: string): string {
  const path = resolve(workspaceRoot, runDir, "error.txt");
  if (!existsSync(path)) return "";
  try {
    return readFileSync(path, "utf-8").trim();
  } catch (error) {
    return `Unable to read workflow error: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
}

function buildAlertText(payload: WorkflowCompletion, errorSummary: string): string {
  const durationSec = (payload.durationMs / 1000).toFixed(1);
  const lines = [
    `Workflow ${payload.status}: *${payload.workflow}*`,
    `Run: \`${payload.runId}\``,
    `Duration: ${durationSec}s`,
  ];
  if (errorSummary) {
    const truncated =
      errorSummary.length > MAX_ERROR_LENGTH
        ? `${errorSummary.slice(0, MAX_ERROR_LENGTH - 3)}...`
        : errorSummary;
    lines.push(`Error: ${truncated}`);
  }
  return lines.join("\n");
}

export function createWorkflowFailureAlertDefinition(
  sourceDefinitions: readonly RegisteredWorkflowDefinitionInput[],
  alertCooldownMs = 0,
): RegisteredWorkflowDefinitionInput {
  const alertingWorkflows = sourceDefinitions
    .filter(
      (definition) =>
        definition.name !== FAILURE_ALERT_WORKFLOW &&
        definition.notify?.onFailure !== false,
    )
    .map((definition) => definition.name);

  return {
    name: FAILURE_ALERT_WORKFLOW,
    description: "Publish operator alerts for failed workflow runs.",
    definitionPath: FAILURE_ALERT_DEFINITION_PATH,
    repository: "none",
    notify: { onFailure: false },
    triggers: [
      {
        event: "workflow.completed",
        filter: {
          workflow: alertingWorkflows.length > 0 ? alertingWorkflows : ["__none__"],
          status: ["failed", "interrupted"],
        },
        cooldownMs: alertCooldownMs,
        queueMode: "all",
      },
    ],
    steps: [
      {
        id: "publish-failure-alert",
        type: "code",
        run: ({ trigger, scopeRoot, emit }) => {
          const payload = trigger.payload as WorkflowCompletion;
          const errorSummary = readErrorFile(scopeRoot, payload.runDir);
          emit("workflow.failure.alert", {
            workflow: payload.workflow,
            runId: payload.runId,
            status: payload.status as "failed" | "interrupted",
            durationMs: payload.durationMs,
            errorSummary,
            text: buildAlertText(payload, errorSummary),
          });
        },
      },
    ],
  };
}

export function withWorkflowFailureAlert(
  sourceDefinitions: readonly RegisteredWorkflowDefinitionInput[] | undefined,
  alertCooldownMs = 0,
): readonly RegisteredWorkflowDefinitionInput[] {
  const definitions = sourceDefinitions ?? [];
  return [
    ...definitions,
    createWorkflowFailureAlertDefinition(definitions, alertCooldownMs),
  ];
}
