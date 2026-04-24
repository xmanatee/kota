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
 *
 * Judge-call recordings (critic, improver semantic gate, any future judge)
 * take the same recording shape and use the same recording path contract.
 * Their response text comes from the run-level judge artifact
 * `<runDir>/<label>.json` (`handleVerdict` writes it via `JSON.stringify`
 * with 2-space indent) rather than a workflow-step artifact. Judges have
 * no tool access by contract (see `AUTONOMY_DISALLOWED_TOOLS`), so
 * `fileOperations` is always empty. Turns/tokens/cost stay at the
 * `1/0/0/0` placeholder the judge artifact does not carry on disk.
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
  /**
   * Optional override for the source commit SHA. Older source runs committed
   * successfully but did not persist the SHA to `steps/commit.json`; an
   * operator who knows the SHA can pass it explicitly so the recorder's
   * diff walk proceeds without recomputing it. `committed=true` is still
   * enforced from the step artifact so a non-committing run can never be
   * recorded.
   */
  explicitCommitSha?: string;
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
  const sourceCommitSha = resolveSourceCommitSha(
    params.projectDir,
    params.sourceRunId,
    params.explicitCommitSha,
  );

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

export type ExtractJudgeRecordingParams = {
  projectDir: string;
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
 * The `turns`/`totalCostUsd`/`inputTokens`/`outputTokens` placeholders
 * match today's hand-authored judge recordings — the judge artifact does
 * not carry those fields on disk, and the replay adapter does not need
 * them for dispatch.
 *
 * Safe to re-run: overwrites the target file on each call. A missing or
 * unparseable `<runDir>/<label>.json` is a hard error naming the run id
 * and label so a source run that never invoked the named judge cannot
 * be silently recorded as an empty verdict.
 */
export function extractJudgeCallRecording(
  params: ExtractJudgeRecordingParams,
): ExtractJudgeRecordingResult {
  const artifactPath = join(
    params.projectDir,
    ".kota",
    "runs",
    params.sourceRunId,
    `${params.label}.json`,
  );
  if (!existsSync(artifactPath)) {
    throw new Error(
      `Judge artifact not found for label "${params.label}" in source run "${params.sourceRunId}": ${artifactPath}. Either the run id or the judge label is wrong, or the source run never invoked this judge.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(artifactPath, "utf-8"));
  } catch (err) {
    throw new Error(
      `Judge artifact "${params.label}.json" in source run "${params.sourceRunId}" is not valid JSON (${artifactPath}): ${(err as Error).message}`,
    );
  }

  const workflowName = readWorkflowName(params.projectDir, params.sourceRunId);
  const recording: AgentStepRecording = {
    version: 1,
    workflowName,
    stepId: params.label,
    sourceRunId: params.sourceRunId,
    response: {
      text: JSON.stringify(parsed, null, 2),
      subtype: "success",
      turns: 1,
      totalCostUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
    fileOperations: [],
  };

  const recordingPath = recordingPathForStep(params.fixtureDir, params.label);
  mkdirSync(dirname(recordingPath), { recursive: true });
  writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");
  return { recordingPath, recording };
}
