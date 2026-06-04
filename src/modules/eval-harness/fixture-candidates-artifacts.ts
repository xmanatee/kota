import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import {
  collectCommandsFromJson,
  collectCommandsFromText,
} from "./fixture-candidates-commands.js";
import {
  asArray,
  isJsonObject,
  parseNullableString,
  parseString,
  parseStringArray,
  readJsonValue,
} from "./fixture-candidates-json.js";
import type {
  CalibrationArtifact,
  DuplicateCoverage,
  FixtureCandidateCommand,
  FixtureCandidateStructuredArtifact,
  JsonValue,
  RunEvidence,
  RunMetadata,
  RunStepArtifact,
  RunSummaryArtifact,
} from "./fixture-candidates-types.js";
import { stableUnique } from "./fixture-candidates-types.js";

const MAX_COMMANDS_PER_RUN = 12;
const MAX_STRUCTURED_ARTIFACTS_PER_RUN = 16;
const TEXT_SCAN_LIMIT = 6000;
const TASK_PATH = /data\/tasks\/(?:ready|doing|done|blocked|backlog|dropped)\/(task-[A-Za-z0-9_.-]+)\.md/g;
const OPERATOR_CAPTURE =
  /\b(?:screenshot|screencast|operator-capture|manual capture|actual conversation|playwright trace)\b/i;

type StructuredArtifactCollection = {
  artifacts: readonly FixtureCandidateStructuredArtifact[];
  malformedArtifacts: readonly FixtureCandidateStructuredArtifact[];
};

function parseMetadata(path: string): RunMetadata {
  const raw = readJsonValue(path);
  if (!isJsonObject(raw)) throw new Error("metadata root is not an object");
  const id = parseString(raw.id);
  const workflow = parseString(raw.workflow);
  const status = parseString(raw.status);
  if (id === undefined || workflow === undefined || status === undefined) {
    throw new Error("metadata missing id, workflow, or status");
  }
  const steps: RunStepArtifact[] = [];
  for (const entry of asArray(raw.steps)) {
    if (!isJsonObject(entry)) continue;
    const stepId = parseString(entry.id);
    const type = parseString(entry.type);
    const stepStatus = parseString(entry.status);
    if (stepId === undefined || type === undefined || stepStatus === undefined) {
      continue;
    }
    steps.push({
      id: stepId,
      type,
      status: stepStatus,
      output: entry.output,
      error: parseString(entry.error),
    });
  }
  return {
    id,
    workflow,
    status,
    startedAt: parseString(raw.startedAt),
    runDir: parseString(raw.runDir),
    trigger: isJsonObject(raw.trigger) ? raw.trigger : undefined,
    steps,
  };
}

function parseRunSummary(path: string): RunSummaryArtifact | null {
  if (!existsSync(path)) return null;
  const raw = readJsonValue(path);
  if (!isJsonObject(raw)) throw new Error("run-summary root is not an object");
  return {
    taskId: parseNullableString(raw.taskId),
    taskTitle: parseNullableString(raw.taskTitle),
    filesChanged: parseStringArray(raw.filesChanged),
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

function parseFixtureProvenance(path: string): { sourceRunId: string | null; id: string } {
  const raw = readJsonValue(path);
  if (!isJsonObject(raw)) return { sourceRunId: null, id: basename(path) };
  const id = parseString(raw.id) ?? basename(path);
  const provenance = raw.provenance;
  if (!isJsonObject(provenance)) return { sourceRunId: null, id };
  const kind = parseString(provenance.kind);
  const sourceRunId = parseString(provenance.sourceRunId);
  return {
    id,
    sourceRunId: kind === "real-failure" && sourceRunId !== undefined
      ? sourceRunId
      : null,
  };
}

export function collectDuplicateCoverage(projectDir: string): DuplicateCoverage {
  const fixtureRoot = join(projectDir, "src/modules/eval-harness/fixtures");
  const byRun = new Map<string, string[]>();
  if (!existsSync(fixtureRoot)) return { coveredRunIds: byRun };
  for (const entry of readdirSync(fixtureRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fixturePath = join(fixtureRoot, entry.name, "fixture.json");
    if (!existsSync(fixturePath)) continue;
    const provenance = parseFixtureProvenance(fixturePath);
    if (provenance.sourceRunId === null) continue;
    const fixtures = byRun.get(provenance.sourceRunId) ?? [];
    fixtures.push(provenance.id);
    byRun.set(provenance.sourceRunId, fixtures.sort());
  }
  return { coveredRunIds: byRun };
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
    const match = path.match(/^data\/tasks\/(ready|doing|done|blocked|backlog|dropped)\/(task-[A-Za-z0-9_.-]+)\.md$/);
    if (match) states.add(`${match[2]}:${match[1]}`);
  }
  for (const id of collectTaskPaths(textEvidence)) states.add(`${id}:mentioned`);
  return [...states].sort();
}

export function readRunEvidence(runDir: string): RunEvidence {
  const metadata = parseMetadata(join(runDir, "metadata.json"));
  const summary = parseRunSummary(join(runDir, "run-summary.json"));
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
    ...(summary?.filesChanged ?? []),
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
    summary,
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
  };
}
