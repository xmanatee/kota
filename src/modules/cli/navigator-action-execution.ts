import type { KotaClient } from "#core/server/kota-client.js";
import type {
  UiAction,
  UiJsonValue,
  UiSurface,
  UiSurfaceBundle,
} from "#modules/daemon-ops/operator-ui.js";
import type { NavigatorState } from "./navigator-state.js";
import type { NavigatorPrompt } from "./navigator-types.js";

type NavigatorMessage = NavigatorState["message"];

function parseActionCommand(raw: string): {
  surfaceId: string;
  actionId: string;
  parameters?: UiJsonValue;
  confirmed: boolean;
} | { error: string } {
  const parts = raw.trim().split(/\s+/);
  if (parts.length < 3) {
    return { error: 'Expected action <surface-id> <action-id> [--yes] [json-parameters].' };
  }
  const [, surfaceId, actionId, ...rest] = parts;
  let confirmed = false;
  const jsonParts: string[] = [];
  for (const part of rest) {
    if (part === "--yes" || part === "-y") {
      confirmed = true;
      continue;
    }
    jsonParts.push(part);
  }
  if (jsonParts.length === 0) return { surfaceId, actionId, confirmed };
  const rawJson = jsonParts.join(" ");
  try {
    return {
      surfaceId,
      actionId,
      confirmed,
      parameters: JSON.parse(rawJson) as UiJsonValue,
    };
  } catch (err) {
    return {
      error: `Action parameters must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

function findAction(surface: UiSurface, actionId: string): UiAction | null {
  return surface.actions.find((action) => action.actionId === actionId) ?? null;
}

function actionResultMessage(result: Awaited<ReturnType<KotaClient["ui"]["executeAction"]>>): NavigatorMessage {
  if (result.ok) return { role: "success", text: `UI action executed: ${result.message}` };
  return { role: "error", text: `UI action failed (${result.reason}): ${result.message}` };
}

function secretInputMessage(action: UiAction): NavigatorMessage | null {
  if (!action.parameters?.fields.some((field) => field.input === "secret")) return null;
  return {
    role: "warn",
    text: `${action.label} needs secret input; this terminal client will not echo secrets into the transcript.`,
  };
}

function firstActiveRunId(surface: UiSurface): string | null {
  return firstTableRunId(surface, "Active run supervision");
}

function firstQueuedRunId(surface: UiSurface): string | null {
  return firstTableRunId(surface, "Queued workflow runs");
}

function firstRecentRunId(surface: UiSurface): string | null {
  return firstTableRunId(surface, "Recent run results");
}

function firstFailedRecentRunId(surface: UiSurface): string | null {
  for (const node of surface.nodes) {
    if (node.kind !== "table" || node.title !== "Recent run results") continue;
    const row = node.rows.find((candidate) => {
      if (candidate.id === "none" || candidate.id === "unavailable") return false;
      const state = candidate.cells.find((cell) => cell.columnId === "state")?.value.toLowerCase() ?? "";
      return state.includes("failed") || state.includes("interrupted");
    });
    return row?.id ?? null;
  }
  return null;
}

function firstTableRunId(surface: UiSurface, title: string): string | null {
  for (const node of surface.nodes) {
    if (node.kind !== "table" || node.title !== title) continue;
    const row = node.rows.find((candidate) => candidate.id !== "none" && candidate.id !== "unavailable");
    return row?.id ?? null;
  }
  return null;
}

async function parametersForSelectedAction(
  surface: UiSurface,
  action: UiAction,
  prompt: NavigatorPrompt,
): Promise<{ parameters?: UiJsonValue } | { message: NavigatorMessage }> {
  if (!action.parameters) return {};
  if (action.actionId === "run.abort") {
    const runId = firstActiveRunId(surface);
    if (runId) return { parameters: { runId } };
  }
  if (action.actionId === "run.cancel-queued") {
    const runId = firstQueuedRunId(surface);
    if (runId) return { parameters: { runId } };
  }
  if (action.actionId === "run.retry") {
    const runId = firstFailedRecentRunId(surface);
    if (runId) return { parameters: { runId } };
  }
  if (action.actionId === "run.replay") {
    const runId = firstRecentRunId(surface);
    if (runId) return { parameters: { runId } };
  }
  const secretMessage = secretInputMessage(action);
  if (secretMessage) return { message: secretMessage };
  const answer = await prompt.ask(`${action.label} parameters JSON (empty for no parameters): `);
  if (answer === null) return { message: { role: "warn", text: `Skipped ${surface.surfaceId}/${action.actionId}.` } };
  const trimmed = answer.trim();
  if (trimmed.length === 0) return {};
  try {
    return { parameters: JSON.parse(trimmed) as UiJsonValue };
  } catch (err) {
    return {
      message: {
        role: "warn",
        text: `Action parameters must be valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
}

async function executeActionRequest(args: {
  surface: UiSurface;
  action: UiAction;
  client: KotaClient;
  prompt: NavigatorPrompt;
  parameters?: UiJsonValue;
  confirmed: boolean;
}): Promise<NavigatorMessage> {
  const { surface, action, client, prompt } = args;
  if (action.readiness.state === "disabled") {
    return { role: "warn", text: `${action.label} is disabled: ${action.readiness.message}` };
  }
  const secretMessage = secretInputMessage(action);
  if (secretMessage) return secretMessage;
  if (action.confirmation.mode === "required" && !args.confirmed) {
    const answer = await prompt.ask(`${action.confirmation.title} - type ${JSON.stringify(action.confirmation.confirmLabel)} to continue: `);
    if (answer === null || answer.trim() !== action.confirmation.confirmLabel) {
      return { role: "warn", text: `Skipped ${surface.surfaceId}/${action.actionId}.` };
    }
  }
  const result = await client.ui.executeAction({
    surfaceId: surface.surfaceId,
    actionId: action.actionId,
    parameters: args.parameters,
  });
  return actionResultMessage(result);
}

export async function executeActionCommand(
  raw: string,
  client: KotaClient,
  prompt: NavigatorPrompt,
  bundle: UiSurfaceBundle,
): Promise<NavigatorMessage> {
  const parsed = parseActionCommand(raw);
  if ("error" in parsed) return { role: "warn", text: parsed.error };
  const surface = bundle.surfaces.find((candidate) => candidate.surfaceId === parsed.surfaceId);
  if (!surface) return { role: "warn", text: `Unknown surface "${parsed.surfaceId}".` };
  const action = findAction(surface, parsed.actionId);
  if (!action) return { role: "warn", text: `Unknown action "${parsed.actionId}" on ${surface.surfaceId}.` };
  return executeActionRequest({
    surface,
    action,
    client,
    prompt,
    parameters: parsed.parameters,
    confirmed: parsed.confirmed,
  });
}

export async function executeSelectedAction(
  state: NavigatorState,
  client: KotaClient,
  prompt: NavigatorPrompt,
): Promise<NavigatorMessage> {
  const surface = state.selectedSurfaceId
    ? state.bundle.surfaces.find((candidate) => candidate.surfaceId === state.selectedSurfaceId)
    : null;
  if (!surface) return { role: "warn", text: "No surface is selected." };
  const action = state.selectedActionId ? findAction(surface, state.selectedActionId) : null;
  if (!action) return { role: "warn", text: `No action is selected on ${surface.surfaceId}.` };
  const parameterResult = await parametersForSelectedAction(surface, action, prompt);
  if ("message" in parameterResult) return parameterResult.message;
  return executeActionRequest({
    surface,
    action,
    client,
    prompt,
    parameters: parameterResult.parameters,
    confirmed: false,
  });
}
