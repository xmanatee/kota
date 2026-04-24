/**
 * Agent-step recording extractor.
 *
 * Scaffolds a recording file from a real `.kota/runs/<id>/steps/<stepId>.json`
 * artifact. The response envelope is lifted verbatim from the source step
 * artifact so the replay returns the literal text, turn count, token usage,
 * and subtype the real agent produced. The file-operation list is seeded
 * from a best-effort scan of the step's `<stepId>.events.jsonl` for Write
 * tool invocations; the fixture author fills in anything the agent mutated
 * through Edit or shelling out (e.g. `pnpm kota task move`, `git mv`),
 * keeping the recording honest relative to the real run without forcing the
 * recorder to reverse-engineer every Bash command.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type {
  AgentStepFileOperation,
  AgentStepRecording,
  AgentStepRecordingResponse,
} from "./agent-step-recording.js";
import { recordingPathForStep } from "./agent-step-recording.js";

/** The subset of `<stepId>.json` we consume. */
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
  /** Project root containing `.kota/runs/<sourceRunId>/…`. */
  projectDir: string;
  /** Source run id (directory name under `.kota/runs/`). */
  sourceRunId: string;
  /** Step id to extract (must be an agent step in the source run). */
  stepId: string;
  /** Target fixture directory; the recording writes under `<fixtureDir>/recordings/<stepId>.json`. */
  fixtureDir: string;
};

export type ExtractRecordingResult = {
  recordingPath: string;
  recording: AgentStepRecording;
  /** Write tool invocations whose path fell outside `projectDir`; the recorder drops them from the recording and reports them so the author can audit. */
  skippedWritesOutsideProject: string[];
};

function readStepArtifact(
  projectDir: string,
  sourceRunId: string,
  stepId: string,
): StepArtifact {
  const path = join(
    projectDir,
    ".kota",
    "runs",
    sourceRunId,
    "steps",
    `${stepId}.json`,
  );
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
  const response: AgentStepRecordingResponse = {
    text: requireString(out.content, "output.content"),
    subtype: requireString(out.subtype, "output.subtype"),
    turns: requireNumber(out.turns, "output.turns"),
    totalCostUsd: requireNumber(out.totalCostUsd, "output.totalCostUsd"),
    inputTokens: requireNumber(out.inputTokens, "output.inputTokens"),
    outputTokens: requireNumber(out.outputTokens, "output.outputTokens"),
    ...(typeof out.sessionId === "string" && { sessionId: out.sessionId }),
  };
  return response;
}

/**
 * Walk the step's events JSONL and collect Write tool invocations whose
 * file_path is absolute inside the project. Edits and Bash side effects
 * are not captured — the author fills them in based on the step's real
 * outcome. Absolute paths are rewritten as cwd-relative; paths inside
 * `.kota/runs/<sourceRunId>/` are rewritten with the `{{runDir}}`
 * placeholder so the recording works against any run id on replay.
 */
function extractWriteOperationsFromEvents(
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
  if (!existsSync(eventsPath)) {
    return { ops: [], skippedOutsideProject: [] };
  }
  const sourceRunDir = join(".kota", "runs", sourceRunId);
  const ops: AgentStepFileOperation[] = [];
  const skippedOutsideProject: string[] = [];
  const seenPaths = new Set<string>();
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
      if (typeof filePath !== "string" || typeof writeContent !== "string") {
        continue;
      }
      const absolute = resolve(filePath);
      const rel = relative(projectDir, absolute);
      if (rel.startsWith("..")) {
        skippedOutsideProject.push(filePath);
        continue;
      }
      const templated = rel.startsWith(`${sourceRunDir}/`)
        ? rel.replace(sourceRunDir, "{{runDir}}")
        : rel;
      // Preserve only the latest write for a given path — multiple writes
      // to the same file in a single agent run collapse to the final one.
      if (seenPaths.has(templated)) {
        const existingIndex = ops.findIndex((o) => o.path === templated);
        if (existingIndex >= 0) ops.splice(existingIndex, 1);
      }
      seenPaths.add(templated);
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
  const artifact = readStepArtifact(
    params.projectDir,
    params.sourceRunId,
    params.stepId,
  );
  if (typeof artifact.id === "string" && artifact.id !== params.stepId) {
    throw new Error(
      `Source step artifact id "${String(artifact.id)}" does not match requested step id "${params.stepId}".`,
    );
  }
  const response = extractResponse(artifact, params.stepId);

  const workflowMetadataPath = join(
    params.projectDir,
    ".kota",
    "runs",
    params.sourceRunId,
    "metadata.json",
  );
  if (!existsSync(workflowMetadataPath)) {
    throw new Error(
      `Source run metadata not found: ${workflowMetadataPath}. The recorder needs it to determine the workflow name.`,
    );
  }
  const workflowMetadata = JSON.parse(
    readFileSync(workflowMetadataPath, "utf-8"),
  ) as { workflow?: unknown };
  if (typeof workflowMetadata.workflow !== "string") {
    throw new Error(
      `Source run metadata missing "workflow" field: ${workflowMetadataPath}`,
    );
  }

  const { ops, skippedOutsideProject } = extractWriteOperationsFromEvents(
    params.projectDir,
    params.sourceRunId,
    params.stepId,
  );

  const recording: AgentStepRecording = {
    version: 1,
    workflowName: workflowMetadata.workflow,
    stepId: params.stepId,
    sourceRunId: params.sourceRunId,
    response,
    fileOperations: ops,
  };

  const recordingPath = recordingPathForStep(
    params.fixtureDir,
    params.stepId,
  );
  writeRecording(recording, recordingPath);
  return {
    recordingPath,
    recording,
    skippedWritesOutsideProject: skippedOutsideProject,
  };
}

function writeRecording(
  recording: AgentStepRecording,
  recordingPath: string,
): void {
  mkdirSync(dirname(recordingPath), { recursive: true });
  writeFileSync(recordingPath, `${JSON.stringify(recording, null, 2)}\n`, "utf-8");
}
