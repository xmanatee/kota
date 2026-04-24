/**
 * Agent-step recording extractor.
 *
 * Scaffolds a recording file from a real `.kota/runs/<id>/steps/<stepId>.json`
 * artifact. The response envelope is lifted verbatim from the source step
 * artifact so the replay returns the literal text, turn count, token usage,
 * and subtype the real agent produced.
 *
 * Repo-tree `fileOperations` come from the commit the source run produced:
 * the recorder reads the SHA from `steps/commit.json`, then walks the
 * commit diff (`recorder-commit-diff.ts`) to emit one `write`/`delete` per
 * touched path, with renames expanded to a delete + write pair. Run-dir
 * paths (under `.kota/runs/<sourceRunId>/`) are never committed; they come
 * from a best-effort Write-event scan of the step's events.jsonl and stay
 * templated to `{{runDir}}`. A source run whose commit step did not commit
 * is a hard error — the recorder will not emit an empty or partial
 * recording.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type {
  AgentStepFileOperation,
  AgentStepRecording,
  AgentStepRecordingResponse,
} from "./agent-step-recording.js";
import { recordingPathForStep } from "./agent-step-recording.js";
import {
  extractCommitDiffOperations,
  resolveSourceCommitSha,
} from "./recorder-commit-diff.js";

type StepArtifactOutput = {
  content?: unknown;
  sessionId?: unknown;
  turns?: unknown;
  totalCostUsd?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  subtype?: unknown;
};

type StepArtifact = {
  id?: unknown;
  type?: unknown;
  output?: StepArtifactOutput;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Step artifact field "${field}" is not a string`);
  }
  return value;
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Step artifact field "${field}" is not a finite number`);
  }
  return value;
}

export type ExtractRecordingParams = {
  projectDir: string;
  sourceRunId: string;
  stepId: string;
  fixtureDir: string;
};

export type ExtractRecordingResult = {
  recordingPath: string;
  recording: AgentStepRecording;
  skippedWritesOutsideProject: string[];
  sourceCommitSha: string;
};

function readStepArtifact(
  projectDir: string,
  sourceRunId: string,
  stepId: string,
): StepArtifact {
  const path = join(projectDir, ".kota", "runs", sourceRunId, "steps", `${stepId}.json`);
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
    text: requireString(out.content, "output.content"),
    subtype: requireString(out.subtype, "output.subtype"),
    turns: requireNumber(out.turns, "output.turns"),
    totalCostUsd: requireNumber(out.totalCostUsd, "output.totalCostUsd"),
    inputTokens: requireNumber(out.inputTokens, "output.inputTokens"),
    outputTokens: requireNumber(out.outputTokens, "output.outputTokens"),
    ...(typeof out.sessionId === "string" && { sessionId: out.sessionId }),
  };
}

function readWorkflowName(projectDir: string, sourceRunId: string): string {
  const path = join(projectDir, ".kota", "runs", sourceRunId, "metadata.json");
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
 * Collect Write tool invocations targeting run-dir paths. Repo-tree paths
 * come from the commit diff, so this scan is limited to `{{runDir}}`-
 * templated run-dir artifacts. Write events pointing outside the project
 * root are reported via `skippedOutsideProject` so the author can audit.
 * Multiple writes to the same run-dir path collapse to the latest write.
 */
function extractRunDirWriteOperations(
  projectDir: string,
  sourceRunId: string,
  stepId: string,
): { ops: AgentStepFileOperation[]; skippedOutsideProject: string[] } {
  const eventsPath = join(
    projectDir,
    ".kota",
    "runs",
    sourceRunId,
    "steps",
    `${stepId}.events.jsonl`,
  );
  if (!existsSync(eventsPath)) return { ops: [], skippedOutsideProject: [] };
  const sourceRunDir = join(".kota", "runs", sourceRunId);
  const ops: AgentStepFileOperation[] = [];
  const skippedOutsideProject: string[] = [];
  const indexByPath = new Map<string, number>();
  for (const line of readFileSync(eventsPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (event.type !== "assistant") continue;
    const inner = event.message as { content?: unknown } | undefined;
    const content = (inner?.content ?? event.content) as unknown;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as {
        type?: string;
        name?: string;
        input?: { file_path?: unknown; content?: unknown };
      };
      if (b.type !== "tool_use" || b.name !== "Write") continue;
      const filePath = b.input?.file_path;
      const writeContent = b.input?.content;
      if (typeof filePath !== "string" || typeof writeContent !== "string") continue;
      const rel = relative(projectDir, resolve(filePath));
      if (rel.startsWith("..")) {
        skippedOutsideProject.push(filePath);
        continue;
      }
      if (rel !== sourceRunDir && !rel.startsWith(`${sourceRunDir}/`)) continue;
      const templated = rel.replace(sourceRunDir, "{{runDir}}");
      const existing = indexByPath.get(templated);
      if (existing !== undefined) ops.splice(existing, 1);
      indexByPath.set(templated, ops.length);
      ops.push({ op: "write", path: templated, content: writeContent });
    }
  }
  return { ops, skippedOutsideProject };
}

/**
 * Extract a recording for a single agent step and write it to the fixture
 * directory. Safe to re-run: overwrites the target file on each call.
 */
export function extractAgentStepRecording(
  params: ExtractRecordingParams,
): ExtractRecordingResult {
  const artifact = readStepArtifact(params.projectDir, params.sourceRunId, params.stepId);
  if (typeof artifact.id === "string" && artifact.id !== params.stepId) {
    throw new Error(
      `Source step artifact id "${String(artifact.id)}" does not match requested step id "${params.stepId}".`,
    );
  }
  const response = extractResponse(artifact, params.stepId);
  const workflowName = readWorkflowName(params.projectDir, params.sourceRunId);
  const sourceCommitSha = resolveSourceCommitSha(params.projectDir, params.sourceRunId);

  const { ops: commitOps, skippedOutsideProject: skippedFromCommit } =
    extractCommitDiffOperations(
      params.projectDir,
      params.sourceRunId,
      sourceCommitSha,
    );
  const { ops: runDirOps, skippedOutsideProject: skippedFromWrites } =
    extractRunDirWriteOperations(
      params.projectDir,
      params.sourceRunId,
      params.stepId,
    );

  const recording: AgentStepRecording = {
    version: 1,
    workflowName,
    stepId: params.stepId,
    sourceRunId: params.sourceRunId,
    response,
    fileOperations: [...commitOps, ...runDirOps],
  };

  const recordingPath = recordingPathForStep(params.fixtureDir, params.stepId);
  mkdirSync(dirname(recordingPath), { recursive: true });
  writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");
  return {
    recordingPath,
    recording,
    skippedWritesOutsideProject: [...skippedFromCommit, ...skippedFromWrites],
    sourceCommitSha,
  };
}
