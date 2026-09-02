import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readWorkflowRunMetadataFile } from "#core/workflow/run-metadata.js";
import {
  collectCommandsFromJson,
  collectCommandsFromText,
} from "./fixture-candidates-commands.js";
import {
  isJsonObject,
  parseNullableString,
  parseStringArray,
  readJsonValue,
} from "./fixture-candidates-json.js";
import { collectPatternSignals } from "./fixture-candidates-patterns.js";
import type {
  CalibrationArtifact,
  FixtureCandidateCommand,
  FixtureCandidateStructuredArtifact,
  JsonObject,
  JsonValue,
  RunEvidence,
  RunMetadata,
  RunStepArtifact,
  WriterIntegrationArtifact,
} from "./fixture-candidates-types.js";
import { stableUnique } from "./fixture-candidates-types.js";

const MAX_COMMANDS_PER_RUN = 12;
const MAX_STRUCTURED_ARTIFACTS_PER_RUN = 16;
const TEXT_SCAN_LIMIT = 6000;
const TASK_PATH = /data\/tasks\/(?:archive\/)?(task-[A-Za-z0-9_.-]+)\.md/g;
const OPERATOR_CAPTURE =
  /\b(?:screenshot|screencast|operator-capture|manual capture|actual conversation|playwright trace)\b/i;

type StructuredArtifactCollection = {
  artifacts: readonly FixtureCandidateStructuredArtifact[];
  malformedArtifacts: readonly FixtureCandidateStructuredArtifact[];
};

function parseMetadata(path: string): RunMetadata {
  const metadata = readWorkflowRunMetadataFile(path);
  if (metadata === null) throw new Error(`metadata is missing: ${path}`);
  const steps: RunStepArtifact[] = metadata.steps.map((step) => ({
    id: step.id,
    type: step.type,
    status: step.status,
    output: step.output as JsonValue | undefined,
    error: step.error,
  }));
  return {
    id: metadata.id,
    workflow: metadata.workflow,
    status: metadata.status,
    startedAt: metadata.startedAt,
    runDir: metadata.runDir,
    trigger: metadata.trigger as JsonObject,
    steps,
  };
}

function parseWriterIntegration(path: string): WriterIntegrationArtifact | null {
  if (!existsSync(path)) return null;
  const raw = readJsonValue(path);
  if (!isJsonObject(raw)) throw new Error("writer-integration root is not an object");
  return {
    changedPaths: parseStringArray(raw.changedPaths),
  };
}

function parseCalibration(path: string): CalibrationArtifact | null {
  if (!existsSync(path)) return null;
  const raw = readJsonValue(path);
  if (!isJsonObject(raw)) {
    throw new Error("evaluator-calibration root is not an object");
  }
  return {
    taskId: parseNullableString(raw.taskId),
    taskFinalState: parseNullableString(raw.taskFinalState),
    sourceFilesChanged: parseStringArray(raw.sourceFilesChanged),
  };
}

function collectStrings(value: JsonValue | undefined, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
    return;
  }
  if (!isJsonObject(value)) return;
  for (const entry of Object.values(value)) collectStrings(entry, out);
}

function summarizeJsonArtifact(raw: JsonValue): string {
  if (isJsonObject(raw)) {
    const keys = Object.keys(raw).sort().slice(0, 5);
    return `object keys: ${keys.join(", ")}`;
  }
  if (Array.isArray(raw)) return `array entries: ${raw.length}`;
  return typeof raw;
}

function appendStructuredArtifact(
  artifacts: FixtureCandidateStructuredArtifact[],
  artifact: FixtureCandidateStructuredArtifact,
): void {
  if (artifacts.length < MAX_STRUCTURED_ARTIFACTS_PER_RUN) artifacts.push(artifact);
}

function collectStructuredArtifacts(runDir: string): StructuredArtifactCollection {
  const artifacts: FixtureCandidateStructuredArtifact[] = [];
  const malformedArtifacts: FixtureCandidateStructuredArtifact[] = [];
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name === "metadata.json" || entry.name === "workflow.json" || entry.name === "trigger.json") {
      continue;
    }
    const path = join(runDir, entry.name);
    if (entry.name.endsWith(".json")) {
      try {
        appendStructuredArtifact(artifacts, {
          path: entry.name,
          kind: "json",
          signal: summarizeJsonArtifact(readJsonValue(path)),
        });
      } catch {
        const artifact: FixtureCandidateStructuredArtifact = {
          path: entry.name,
          kind: "json",
          signal: "malformed json",
        };
        appendStructuredArtifact(artifacts, artifact);
        malformedArtifacts.push(artifact);
      }
    } else if (entry.name.endsWith(".jsonl")) {
      const lines = readFileSync(path, "utf-8").split("\n").filter((lineText) => lineText.trim().length > 0);
      appendStructuredArtifact(artifacts, {
        path: entry.name,
        kind: "jsonl",
        signal: `${lines.length} record(s)`,
      });
    } else if (entry.name.endsWith(".txt") || entry.name.endsWith(".md")) {
      appendStructuredArtifact(artifacts, {
        path: entry.name,
        kind: "text",
        signal: "text evidence",
      });
    }
  }
  return {
    artifacts: artifacts.sort((a, b) => a.path.localeCompare(b.path)),
    malformedArtifacts: malformedArtifacts.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

function collectRunTextEvidence(runDir: string, metadata: RunMetadata): string {
  const chunks: string[] = [];
  for (const step of metadata.steps) {
    if (typeof step.error === "string") chunks.push(step.error);
    collectStrings(step.output, chunks);
  }
  for (const entry of readdirSync(runDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".txt") && !entry.name.endsWith(".md")) continue;
    chunks.push(readFileSync(join(runDir, entry.name), "utf-8").slice(0, TEXT_SCAN_LIMIT));
  }
  return chunks.join("\n");
}

function collectTaskPaths(text: string): readonly string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(TASK_PATH)) out.add(match[1]);
  return [...out].sort();
}

function collectTaskMoves(
  changedPaths: readonly string[],
  textEvidence: string,
): readonly string[] {
  const states = new Set<string>();
  for (const path of changedPaths) {
    const match = path.match(/^data\/tasks\/(archive\/)?(task-[A-Za-z0-9_.-]+)\.md$/);
    if (match) states.add(`${match[2]}:${match[1] ? "archived" : "active"}`);
  }
  for (const id of collectTaskPaths(textEvidence)) states.add(`${id}:mentioned`);
  return [...states].sort();
}

export function readRunEvidence(runDir: string): RunEvidence {
  const metadata = parseMetadata(join(runDir, "metadata.json"));
  const integration = parseWriterIntegration(join(runDir, "writer-integration.json"));
  const calibration = parseCalibration(join(runDir, "evaluator-calibration.json"));
  const commands: FixtureCandidateCommand[] = [];
  const seenCommands = new Set<string>();
  for (const step of metadata.steps) {
    if (step.error !== undefined) {
      collectCommandsFromText(step.error, `metadata.steps.${step.id}.error`, commands, seenCommands);
    }
    collectCommandsFromJson(step.output, `metadata.steps.${step.id}.output`, commands, seenCommands);
  }
  const stepsDir = join(runDir, "steps");
  const malformedStepArtifacts: FixtureCandidateStructuredArtifact[] = [];
  if (existsSync(stepsDir)) {
    for (const entry of readdirSync(stepsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        collectCommandsFromJson(readJsonValue(join(stepsDir, entry.name)), `steps/${entry.name}`, commands, seenCommands);
      } catch {
        malformedStepArtifacts.push({
          path: `steps/${entry.name}`,
          kind: "json",
          signal: "malformed json",
        });
      }
    }
  }
  const textEvidence = collectRunTextEvidence(runDir, metadata);
  collectCommandsFromText(textEvidence, "run-text", commands, seenCommands);
  const changedPaths = stableUnique([
    ...(integration?.changedPaths ?? []),
    ...(calibration?.sourceFilesChanged ?? []),
  ]);
  const structuredArtifacts = collectStructuredArtifacts(runDir);
  const malformedArtifacts = [
    ...structuredArtifacts.malformedArtifacts,
    ...malformedStepArtifacts,
  ].sort((a, b) => a.path.localeCompare(b.path));
  return {
    runDir,
    metadata,
    integration,
    calibration,
    commands: commands.slice(0, MAX_COMMANDS_PER_RUN),
    changedPaths,
    structuredArtifacts: [
      ...structuredArtifacts.artifacts,
      ...malformedStepArtifacts,
    ].sort((a, b) => a.path.localeCompare(b.path)),
    malformedArtifacts,
    taskStateMoves: collectTaskMoves(changedPaths, textEvidence),
    operatorCaptureMentioned: OPERATOR_CAPTURE.test(textEvidence),
    patternSignals: collectPatternSignals(runDir, metadata, textEvidence),
  };
}
