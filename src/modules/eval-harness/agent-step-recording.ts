/**
 * Recorded agent-step responses for the eval-harness replay adapter.
 *
 * A recording lives at `<fixtureDir>/recordings/<stepId>.json` and encodes
 * enough real evidence from a past `.kota/runs/<id>/steps/<stepId>/` run to
 * let fixture replays exercise an agent-call branch deterministically:
 *
 *  - the final text response envelope (text, subtype, turns, token/cost
 *    counts, optional session id) — lifted verbatim from the source run's
 *    `steps/<stepId>.json`, so the response the replay returns is the one
 *    the real agent produced;
 *  - the post-agent file state the workflow reads afterwards (new/edited
 *    task files, run-directory `commit-message.txt` and `notes.md`, task
 *    deletions), encoded as a typed `fileOperations` sequence applied to
 *    the fixture working directory.
 *
 * Provenance pins the recording to a single source run id. The loader
 * rejects an agent-call fixture (one whose `recordings/` directory is
 * non-empty) whose recording file is missing or whose `sourceRunId` does
 * not match the fixture's real-failure provenance.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SUPPORTED_RECORDING_VERSION = 1;

/** Final agent result envelope replayed as the harness `run` return value. */
export type AgentStepRecordingResponse = {
  text: string;
  subtype: string;
  turns: number;
  totalCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  sessionId?: string;
};

/**
 * One post-agent file mutation applied by the replay adapter before it
 * returns. Paths are cwd-relative; `{{runDir}}` anywhere in a path is
 * substituted with the current run directory extracted from the agent
 * prompt, so a recording can reference the source run's runDir without
 * hard-coding a run id that changes per fixture replay.
 */
export type AgentStepFileOperation =
  | { op: "write"; path: string; content: string }
  | { op: "delete"; path: string };

export type AgentStepRecording = {
  version: 1;
  workflowName: string;
  stepId: string;
  sourceRunId: string;
  response: AgentStepRecordingResponse;
  fileOperations: AgentStepFileOperation[];
};

export class AgentStepRecordingError extends Error {
  readonly recordingPath: string;
  constructor(recordingPath: string, reason: string) {
    super(`Agent-step recording at "${recordingPath}" is invalid: ${reason}`);
    this.name = "AgentStepRecordingError";
    this.recordingPath = recordingPath;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseResponse(
  raw: unknown,
  recordingPath: string,
): AgentStepRecordingResponse {
  if (!isObject(raw)) {
    throw new AgentStepRecordingError(
      recordingPath,
      'missing "response" object (text, subtype, turns, totalCostUsd, inputTokens, outputTokens).',
    );
  }
  const requiredStrings: Array<keyof AgentStepRecordingResponse> = [
    "text",
    "subtype",
  ];
  for (const key of requiredStrings) {
    if (typeof raw[key] !== "string") {
      throw new AgentStepRecordingError(
        recordingPath,
        `response.${key} must be a string.`,
      );
    }
  }
  const requiredNumbers: Array<keyof AgentStepRecordingResponse> = [
    "turns",
    "totalCostUsd",
    "inputTokens",
    "outputTokens",
  ];
  for (const key of requiredNumbers) {
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key])) {
      throw new AgentStepRecordingError(
        recordingPath,
        `response.${key} must be a finite number.`,
      );
    }
  }
  if (raw.sessionId !== undefined && typeof raw.sessionId !== "string") {
    throw new AgentStepRecordingError(
      recordingPath,
      "response.sessionId must be a string when present.",
    );
  }
  return {
    text: raw.text as string,
    subtype: raw.subtype as string,
    turns: raw.turns as number,
    totalCostUsd: raw.totalCostUsd as number,
    inputTokens: raw.inputTokens as number,
    outputTokens: raw.outputTokens as number,
    ...(typeof raw.sessionId === "string" && { sessionId: raw.sessionId }),
  };
}

function parseFileOperations(
  raw: unknown,
  recordingPath: string,
): AgentStepFileOperation[] {
  if (!Array.isArray(raw)) {
    throw new AgentStepRecordingError(
      recordingPath,
      '"fileOperations" must be an array (may be empty).',
    );
  }
  const ops: AgentStepFileOperation[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || typeof entry.path !== "string" || entry.path.length === 0) {
      throw new AgentStepRecordingError(
        recordingPath,
        `fileOperations entry ${JSON.stringify(entry)} must be an object with a non-empty string "path".`,
      );
    }
    if (entry.op === "write") {
      if (typeof entry.content !== "string") {
        throw new AgentStepRecordingError(
          recordingPath,
          `fileOperations write entry at path ${JSON.stringify(entry.path)} must include a string "content".`,
        );
      }
      ops.push({ op: "write", path: entry.path, content: entry.content });
      continue;
    }
    if (entry.op === "delete") {
      ops.push({ op: "delete", path: entry.path });
      continue;
    }
    throw new AgentStepRecordingError(
      recordingPath,
      `fileOperations entry at path ${JSON.stringify(entry.path)} has unknown op ${JSON.stringify(entry.op)}; legal values: "write", "delete".`,
    );
  }
  return ops;
}

export function parseAgentStepRecording(
  rawJson: string,
  recordingPath: string,
): AgentStepRecording {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch (err) {
    throw new AgentStepRecordingError(
      recordingPath,
      `unparseable JSON: ${(err as Error).message}`,
    );
  }
  if (!isObject(raw)) {
    throw new AgentStepRecordingError(
      recordingPath,
      "recording file must be a JSON object.",
    );
  }
  if (raw.version !== SUPPORTED_RECORDING_VERSION) {
    throw new AgentStepRecordingError(
      recordingPath,
      `unsupported version ${JSON.stringify(raw.version)}; only version ${SUPPORTED_RECORDING_VERSION} is supported.`,
    );
  }
  for (const key of ["workflowName", "stepId", "sourceRunId"] as const) {
    if (typeof raw[key] !== "string" || (raw[key] as string).length === 0) {
      throw new AgentStepRecordingError(
        recordingPath,
        `"${key}" must be a non-empty string.`,
      );
    }
  }
  const response = parseResponse(raw.response, recordingPath);
  const fileOperations = parseFileOperations(raw.fileOperations, recordingPath);
  return {
    version: SUPPORTED_RECORDING_VERSION,
    workflowName: raw.workflowName as string,
    stepId: raw.stepId as string,
    sourceRunId: raw.sourceRunId as string,
    response,
    fileOperations,
  };
}

/** Absolute directory that holds a fixture's agent-step recordings. */
export function recordingsDirForFixture(fixtureDir: string): string {
  return join(fixtureDir, "recordings");
}

/** Absolute path to the recording file for a given step. */
export function recordingPathForStep(
  fixtureDir: string,
  stepId: string,
): string {
  return join(recordingsDirForFixture(fixtureDir), `${stepId}.json`);
}

/**
 * Load and validate every recording present in a fixture's `recordings/`
 * directory. Returns an empty array when no `recordings/` directory exists.
 * Throws `AgentStepRecordingError` on any malformed recording — silent skips
 * would hide fixture coverage regressions.
 */
export function loadAgentStepRecordings(
  fixtureDir: string,
): AgentStepRecording[] {
  const dir = recordingsDirForFixture(fixtureDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const recordings: AgentStepRecording[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const recordingPath = join(dir, entry.name);
    const stepId = entry.name.replace(/\.json$/, "");
    const recording = parseAgentStepRecording(
      readFileSync(recordingPath, "utf-8"),
      recordingPath,
    );
    if (recording.stepId !== stepId) {
      throw new AgentStepRecordingError(
        recordingPath,
        `recording stepId ${JSON.stringify(recording.stepId)} does not match filename ${JSON.stringify(stepId)}.`,
      );
    }
    recordings.push(recording);
  }
  return recordings;
}
