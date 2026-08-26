/**
 * Agent-step and judge-call recording extractor.
 *
 * Repo-tree `fileOperations` come from the commit the source run produced:
 * the recorder reads the published range from `writer-integration.json`, then
 * walks that diff (`recorder-commit-diff.ts`) to emit one `write`/`delete` per
 * touched path, with renames expanded to a delete + write pair. Run-dir
 * paths (under `.kota/runs/<sourceRunId>/`) are never committed; they come
 * from a best-effort Write-event scan of the step's events.jsonl, with a
 * narrow fallback for known agent-authored run artifacts, and stay templated
 * to `{{runDir}}`. A source run that did not integrate writer changes is a hard
 * error — the recorder will not emit an empty or partial recording.
 *
 * Judge-call recordings (critic, improver semantic gate, any future judge)
 * take the same recording shape and use the same recording path contract.
 * Their response text comes from the run-level judge artifact
 * `<runDir>/<label>.json` (`handleVerdict` writes it via `JSON.stringify`
 * with 2-space indent) rather than a workflow-step artifact. Judges have
 * no tool access by contract (see `AUTONOMY_DISALLOWED_TOOLS`), so
 * `fileOperations` is always empty. Judge artifacts do not carry usage,
 * so recordings preserve that absence as unknown telemetry.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseAgentUsage, UNKNOWN_AGENT_USAGE } from "#core/agent-harness/usage.js";
import type {
  AgentStepRecording,
  AgentStepRecordingResponse,
} from "./agent-step-recording.js";
import { recordingPathForStep } from "./agent-step-recording.js";
import {
  extractCommitDiffOperations,
  resolveSourceIntegrationRange,
} from "./recorder-commit-diff.js";
import { requireRecorderIdentifier } from "./recorder-paths.js";
import { extractRunDirWriteOperations } from "./recorder-run-dir-writes.js";

type StepArtifactOutput = {
  content?: unknown;
  sessionId?: unknown;
  turns?: unknown;
  subtype?: unknown;
};

type StepArtifact = {
  id?: unknown;
  type?: unknown;
  usage?: unknown;
  output?: StepArtifactOutput;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Step artifact field "${field}" is not a string`);
  }
  return value;
}

function responseContentText(value: StepArtifactOutput["content"]): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const marker = value as { redacted?: boolean; reason?: string; bytes?: number };
    if (
      marker.redacted === true &&
      typeof marker.reason === "string" &&
      typeof marker.bytes === "number" &&
      Number.isFinite(marker.bytes)
    ) {
      return JSON.stringify({
        redacted: true,
        reason: marker.reason,
        bytes: marker.bytes,
      });
    }
  }
  throw new Error(
    'Step artifact field "output.content" is neither a string nor a redacted evidence marker',
  );
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Step artifact field "${field}" is not a finite number`);
  }
  return value;
}

export type ExtractRecordingParams = {
  workspaceRoot: string;
  sourceRunId: string;
  stepId: string;
  fixtureDir: string;
};

export type ExtractRecordingResult = {
  recordingPath: string;
  recording: AgentStepRecording;
  skippedWritesOutsideWorkspace: string[];
  sourceCommitSha: string;
};

function readStepArtifact(
  workspaceRoot: string,
  sourceRunId: string,
  stepId: string,
): StepArtifact {
  const path = join(workspaceRoot, ".kota", "runs", sourceRunId, "steps", `${stepId}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `Source step artifact not found: ${path}. Either the run id or the step id is wrong.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Source step artifact is not a JSON object: ${path}`);
  }
  return raw as StepArtifact;
}

function extractResponse(
  artifact: StepArtifact,
  stepId: string,
): AgentStepRecordingResponse {
  if (artifact.type !== "agent") {
    throw new Error(
      `Step "${stepId}" is not an agent step (type=${JSON.stringify(artifact.type)}); only agent steps need recordings.`,
    );
  }
  const out = artifact.output;
  if (!out || typeof out !== "object") {
    throw new Error(`Step "${stepId}" has no output object.`);
  }
  return {
    text: responseContentText(out.content),
    subtype: requireString(out.subtype, "output.subtype"),
    turns: requireNumber(out.turns, "output.turns"),
    usage: parseAgentUsage(artifact.usage, "usage"),
    ...(typeof out.sessionId === "string" && { sessionId: out.sessionId }),
  };
}

function readWorkflowName(workspaceRoot: string, sourceRunId: string): string {
  const path = join(workspaceRoot, ".kota", "runs", sourceRunId, "metadata.json");
  if (!existsSync(path)) {
    throw new Error(
      `Source run metadata not found: ${path}. The recorder needs it to determine the workflow name.`,
    );
  }
  const meta = JSON.parse(readFileSync(path, "utf-8")) as { workflow?: unknown };
  if (typeof meta.workflow !== "string") {
    throw new Error(`Source run metadata missing "workflow" field: ${path}`);
  }
  return meta.workflow;
}

/**
 * Extract a recording for a single agent step and write it to the fixture
 * directory. Safe to re-run: overwrites the target file on each call.
 */
export function extractAgentStepRecording(
  params: ExtractRecordingParams,
): ExtractRecordingResult {
  const sourceRunId = requireRecorderIdentifier(params.sourceRunId, "--run-id");
  const stepId = requireRecorderIdentifier(params.stepId, "--step");
  const artifact = readStepArtifact(params.workspaceRoot, sourceRunId, stepId);
  if (typeof artifact.id === "string" && artifact.id !== stepId) {
    throw new Error(
      `Source step artifact id "${String(artifact.id)}" does not match requested step id "${stepId}".`,
    );
  }
  const response = extractResponse(artifact, stepId);
  const workflowName = readWorkflowName(params.workspaceRoot, sourceRunId);
  const sourceRange = resolveSourceIntegrationRange(params.workspaceRoot, sourceRunId);
  const sourceCommitSha = sourceRange.publishedHead;

  const { ops: commitOps, skippedOutsideWorkspace: skippedFromCommit } =
    extractCommitDiffOperations(
      params.workspaceRoot,
      sourceRunId,
      sourceRange.baseHead,
      sourceRange.publishedHead,
    );
  const { ops: runDirOps, skippedOutsideWorkspace: skippedFromWrites } =
    extractRunDirWriteOperations(params.workspaceRoot, sourceRunId, stepId);

  const recording: AgentStepRecording = {
    version: 2,
    workflowName,
    stepId,
    sourceRunId,
    response,
    fileOperations: [...commitOps, ...runDirOps],
  };

  const recordingPath = recordingPathForStep(params.fixtureDir, stepId);
  mkdirSync(dirname(recordingPath), { recursive: true });
  writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");
  return {
    recordingPath,
    recording,
    skippedWritesOutsideWorkspace: [...skippedFromCommit, ...skippedFromWrites],
    sourceCommitSha,
  };
}

export type ExtractJudgeRecordingParams = {
  workspaceRoot: string;
  sourceRunId: string;
  label: string;
  fixtureDir: string;
};

export type ExtractJudgeRecordingResult = {
  recordingPath: string;
  recording: AgentStepRecording;
};

/**
 * Extract a judge-call recording (critic, improver semantic gate, future
 * judges) from the source run's `<runDir>/<label>.json` artifact. The
 * artifact is the normalized verdict `handleVerdict` persists; the
 * recording wraps it as `response.text` so the replay adapter returns the
 * same JSON the real judge produced.
 *
 * Judge calls have no tool access (see `AUTONOMY_DISALLOWED_TOOLS` in
 * `src/modules/autonomy/shared.ts`), so `fileOperations` is always empty.
 * Usage is unknown because the judge artifact does not carry telemetry.
 *
 * Safe to re-run: overwrites the target file on each call. A missing or
 * unparseable `<runDir>/<label>.json` is a hard error naming the run id
 * and label so a source run that never invoked the named judge cannot
 * be silently recorded as an empty verdict.
 */
export function extractJudgeCallRecording(
  params: ExtractJudgeRecordingParams,
): ExtractJudgeRecordingResult {
  const sourceRunId = requireRecorderIdentifier(params.sourceRunId, "--run-id");
  const label = requireRecorderIdentifier(params.label, "--judge");
  const artifactPath = join(
    params.workspaceRoot,
    ".kota",
    "runs",
    sourceRunId,
    `${label}.json`,
  );
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Judge artifact not found for label "${label}" in source run "${sourceRunId}": ${artifactPath}. Either the run id or the judge label is wrong, or the source run never invoked this judge.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(artifactPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Judge artifact "${label}.json" in source run "${sourceRunId}" is not valid JSON (${artifactPath}): ${(err as Error).message}`,
    );
  }

  const workflowName = readWorkflowName(params.workspaceRoot, sourceRunId);
  const recording: AgentStepRecording = {
    version: 2,
    workflowName,
    stepId: label,
    sourceRunId,
    response: {
      text: JSON.stringify(parsed, null, 2),
      subtype: "success",
      turns: 1,
      usage: UNKNOWN_AGENT_USAGE,
    },
    fileOperations: [],
  };

  const recordingPath = recordingPathForStep(params.fixtureDir, label);
  mkdirSync(dirname(recordingPath), { recursive: true });
  writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");
  return { recordingPath, recording };
}
