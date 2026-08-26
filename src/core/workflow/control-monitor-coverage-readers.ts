import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import type {
  EventEnvelope,
  EventJournal,
  EventJsonObject,
  EventJsonValue,
} from "#core/events/event-journal.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import {
  readWriterIntegrationEvidence,
} from "./writer-integration-evidence.js";

export type SnapshotStep = {
  id: string;
  type: string;
  event: string | null;
  autonomyMode: string | null;
  agentMessageStreamPolicy: AgentMessageStreamPolicy | null;
  tokenBudgetMaxTotalTokens: number | null;
};

export type AgentMessageStreamPolicy =
  | "buffer-until-validation-success";

export type CoverageEvent = {
  name: string;
  payload: EventJsonObject;
  evidenceRef: string;
};

export type TelemetryCall = {
  tool: string;
  externalContent: boolean;
};

export function isJsonObject(
  value: EventJsonValue | undefined,
): value is EventJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(value: EventJsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function numberField(value: EventJsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function boolField(value: EventJsonValue | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export function arrayField(value: EventJsonValue | undefined): EventJsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function readJsonObject(path: string): EventJsonObject | null {
  const value = readOptionalJsonFile<EventJsonValue>(path);
  return isJsonObject(value) ? value : null;
}

function triggerPayloadString(
  value: WorkflowRunTrigger["payload"][string],
): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function triggerPayloadObject(
  value: WorkflowRunTrigger["payload"][string],
): WorkflowRunTrigger["payload"] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as WorkflowRunTrigger["payload"];
}

export function triggerPayloadLinkedRunIds(
  payload: WorkflowRunTrigger["payload"],
): string[] {
  const ids: string[] = [];
  const add = (id: string | undefined): void => {
    if (id !== undefined) ids.push(id);
  };

  add(triggerPayloadString(payload.runId));
  add(triggerPayloadString(payload.sourceRunId));

  if (Array.isArray(payload.inputEvents)) {
    for (const event of payload.inputEvents) {
      const eventObject = triggerPayloadObject(event);
      const eventPayload = eventObject === null
        ? null
        : triggerPayloadObject(eventObject.payload);
      if (eventPayload === null) continue;
      add(triggerPayloadString(eventPayload.runId));
      add(triggerPayloadString(eventPayload.sourceRunId));
    }
  }

  return [...new Set(ids)];
}

function normalizePath(path: string): string {
  return path.split("\\").join("/");
}

export function artifactRef(projectDir: string, path: string): string {
  return normalizePath(relative(projectDir, path));
}

export function runArtifactRef(
  projectDir: string,
  runDirPath: string,
  name: string,
): string {
  return artifactRef(projectDir, join(runDirPath, name));
}

export function fileNonEmpty(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).size > 0;
  } catch {
    return false;
  }
}

export function readJsonlEvents(
  path: string,
  projectDir: string,
): CoverageEvent[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split("\n");
  const events: CoverageEvent[] = [];
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = JSON.parse(trimmed) as EventJsonObject;
    const name = stringField(parsed.event);
    const payload = isJsonObject(parsed.payload) ? parsed.payload : {};
    if (name) {
      events.push({
        name,
        payload,
        evidenceRef: `${artifactRef(projectDir, path)}#L${index + 1}`,
      });
    }
  }
  return events;
}

function journalPayload(envelope: EventEnvelope): EventJsonObject {
  return envelope.payload.kind === "inline" ? envelope.payload.payload : {};
}

export function journalEventsForRun(args: {
  eventJournal?: EventJournal;
  metadata: WorkflowRunMetadata;
  projectDir: string;
  runDirPath: string;
}): CoverageEvent[] {
  const { eventJournal, metadata, projectDir, runDirPath } = args;
  if (!eventJournal) return [];
  const sinceMs = Math.max(0, Date.parse(metadata.startedAt) - 1);
  const sessionIds = sessionIdsForRun(metadata, runDirPath);
  return eventJournal
    .query({ sinceMs })
    .filter((envelope) => {
      const payload = journalPayload(envelope);
      if (
        envelope.producer.kind === "workflow" &&
        envelope.producer.runId === metadata.id
      ) {
        return true;
      }
      if (stringField(payload.runId) === metadata.id) return true;
      const sessionId =
        stringField(payload.session) ?? stringField(payload.sessionId);
      return sessionId !== null && sessionIds.has(sessionId);
    })
    .map((envelope) => ({
      name: envelope.event.name,
      payload: journalPayload(envelope),
      evidenceRef: `${artifactRef(projectDir, eventJournal.getPath())}#${envelope.id}`,
    }));
}

function sessionIdsForRun(
  metadata: WorkflowRunMetadata,
  runDirPath: string,
): Set<string> {
  const sessionIds = new Set<string>();
  for (const step of metadata.steps) {
    const output = step.output as EventJsonValue | undefined;
    if (isJsonObject(output)) {
      const sessionId = stringField(output.sessionId);
      if (sessionId) sessionIds.add(sessionId);
    }
    const eventsPath = join(runDirPath, "steps", `${step.id}.events.jsonl`);
    if (!existsSync(eventsPath)) continue;
    const lines = readFileSync(eventsPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed) as EventJsonValue;
      if (!isJsonObject(parsed)) continue;
      const sessionId = stringField(parsed.sessionId);
      if (sessionId) sessionIds.add(sessionId);
    }
  }
  return sessionIds;
}

export function snapshotStepsFrom(raw: EventJsonObject | null): SnapshotStep[] {
  if (!raw) return [];
  const defaultAutonomyMode = stringField(raw.defaultAutonomyMode);
  return arrayField(raw.steps).flatMap((step) =>
    collectSnapshotStep(step, defaultAutonomyMode)
  );
}

function agentMessageStreamPolicy(
  value: EventJsonValue | undefined,
): AgentMessageStreamPolicy | null {
  const policy = stringField(value);
  return policy === "buffer-until-validation-success" ? policy : null;
}

function collectSnapshotStep(
  raw: EventJsonValue | undefined,
  inheritedAutonomyMode: string | null,
): SnapshotStep[] {
  if (!isJsonObject(raw)) return [];
  const id = stringField(raw.id);
  const type = stringField(raw.type);
  if (!id || !type) return [];
  const autonomyMode = stringField(raw.autonomyMode) ?? inheritedAutonomyMode;
  const tokenBudget = isJsonObject(raw.tokenBudget) ? raw.tokenBudget : null;
  const current: SnapshotStep = {
    id,
    type,
    event: stringField(raw.event),
    autonomyMode,
    agentMessageStreamPolicy: agentMessageStreamPolicy(raw.agentMessageStreamPolicy),
    tokenBudgetMaxTotalTokens: numberField(tokenBudget?.maxTotalTokens),
  };
  return [
    current,
    ...arrayField(raw.steps).flatMap((step) =>
      collectSnapshotStep(step, autonomyMode)
    ),
    ...arrayField(raw.ifTrue).flatMap((step) =>
      collectSnapshotStep(step, autonomyMode)
    ),
    ...arrayField(raw.ifFalse).flatMap((step) =>
      collectSnapshotStep(step, autonomyMode)
    ),
  ];
}

export function runEvidenceHeadSha(
  runDirPath: string,
  capturedHead: string | null,
): string | null {
  const runId = basename(runDirPath);
  return readWriterIntegrationEvidence(dirname(runDirPath), runId)?.publishedHead ??
    capturedHead;
}

export function telemetryCalls(path: string): TelemetryCall[] {
  const artifact = readJsonObject(path);
  if (!artifact) return [];
  const calls = arrayField(artifact.calls);
  if (calls.length > 0) {
    return calls
      .filter(isJsonObject)
      .map((call) => ({
        tool: stringField(call.tool) ?? "(unknown)",
        externalContent: telemetryCallHasExternalContent(call),
      }));
  }
  const tools = isJsonObject(artifact.tools) ? artifact.tools : {};
  return Object.keys(tools).map((tool) => ({ tool, externalContent: false }));
}

function telemetryCallHasExternalContent(call: EventJsonObject): boolean {
  const provenance = call.resultContentProvenance;
  if (!isJsonObject(provenance)) return false;
  return stringField(provenance.kind) === "external-mcp";
}
