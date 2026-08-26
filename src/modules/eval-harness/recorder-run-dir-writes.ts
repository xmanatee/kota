import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AgentStepFileOperation } from "./agent-step-recording.js";
import type { FixtureJsonValue } from "./fixture-common-types.js";
import { isJsonObject } from "./fixture-parse-utils.js";

const AGENT_AUTHORED_RUN_DIR_ARTIFACTS = [
  "commit-message.txt",
] as const;

export type RunDirWriteExtraction = {
  ops: AgentStepFileOperation[];
  skippedOutsideProject: string[];
};

type WriteToolUse = {
  filePath: string;
  content: string;
};

function assistantContentBlocks(line: string): FixtureJsonValue[] {
  let parsed: FixtureJsonValue;
  try {
    parsed = JSON.parse(line) as FixtureJsonValue;
  } catch {
    return [];
  }
  if (!isJsonObject(parsed) || parsed.type !== "assistant") return [];
  const messageContent = isJsonObject(parsed.message)
    ? parsed.message.content
    : undefined;
  const content = messageContent ?? parsed.content;
  return Array.isArray(content) ? content : [];
}

function writeToolUse(block: FixtureJsonValue): WriteToolUse | null {
  if (!isJsonObject(block)) return null;
  if (block.type !== "tool_use" || block.name !== "Write") return null;
  if (!isJsonObject(block.input)) return null;
  const filePath = block.input.file_path;
  const content = block.input.content;
  if (typeof filePath !== "string" || typeof content !== "string") {
    return null;
  }
  return { filePath, content };
}

/**
 * Collect Write tool invocations targeting run-dir paths. Repo-tree paths
 * come from the commit diff, so this scan is limited to `{{runDir}}`-
 * templated run-dir artifacts. Write events pointing outside the project
 * root are reported via `skippedOutsideProject` so the author can audit.
 * Multiple writes to the same run-dir path collapse to the latest write.
 */
export function extractRunDirWriteOperations(
  projectDir: string,
  sourceRunId: string,
  stepId: string,
): RunDirWriteExtraction {
  const eventsPath = join(
    projectDir,
    ".kota",
    "runs",
    sourceRunId,
    "steps",
    `${stepId}.events.jsonl`,
  );
  const sourceRunDir = join(".kota", "runs", sourceRunId);
  const ops: AgentStepFileOperation[] = [];
  const skippedOutsideProject: string[] = [];
  const indexByPath = new Map<string, number>();
  if (existsSync(eventsPath)) {
    for (const line of readFileSync(eventsPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      for (const block of assistantContentBlocks(trimmed)) {
        const write = writeToolUse(block);
        if (!write) continue;
        const rel = relative(projectDir, resolve(write.filePath));
        if (rel.startsWith("..")) {
          skippedOutsideProject.push(write.filePath);
          continue;
        }
        if (rel !== sourceRunDir && !rel.startsWith(`${sourceRunDir}/`)) continue;
        const templated = rel.replace(sourceRunDir, "{{runDir}}");
        const existing = indexByPath.get(templated);
        if (existing !== undefined) ops.splice(existing, 1);
        indexByPath.set(templated, ops.length);
        ops.push({ op: "write", path: templated, content: write.content });
      }
    }
  }
  for (const artifact of AGENT_AUTHORED_RUN_DIR_ARTIFACTS) {
    const templated = join("{{runDir}}", artifact);
    if (indexByPath.has(templated)) continue;
    const artifactPath = join(projectDir, sourceRunDir, artifact);
    if (!existsSync(artifactPath)) continue;
    indexByPath.set(templated, ops.length);
    ops.push({
      op: "write",
      path: templated,
      content: readFileSync(artifactPath, "utf-8"),
    });
  }
  return { ops, skippedOutsideProject };
}
