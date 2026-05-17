/**
 * Execute a coding-task scenario against a single `AgentHarness` and capture
 * paired artifacts for operator review. Reuses the existing `runAgentHarness`
 * entry point the CLI already calls — there is no second benchmarking path.
 *
 * Artifacts land under `<outBaseDir>/<harnessName>/` so every harness result
 * for a scenario is side-by-side in one directory.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  AgentEffort,
  AgentHarness,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaAgentMessage,
  KotaContentBlock,
  KotaToolResultBlock,
} from "#core/agent-harness/index.js";
import { runAgentHarness } from "#core/agent-harness/index.js";
import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import {
  buildHarnessCapabilitySnapshot,
  type HarnessCapabilitySnapshot,
  summarizeHarnessCapability,
} from "./capability-snapshot.js";
import type { LoadedScenario, ScenarioVerification } from "./scenario.js";

const DEFAULT_EFFORT: AgentEffort = "xhigh";

const TRACE_TAIL_LIMIT = 32_000;
const DIFF_TAIL_LIMIT = 200_000;
const TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT = 8_000;
const TRAJECTORY_ARTIFACT_NAME = "trajectory.json";
const TRAJECTORY_SUMMARY_NAME = "trajectory-summary.md";

export type HarnessParityCallOptions = {
  /** Model identifier the harness should use (resolved from the active preset by the caller). */
  model: string;
  /** Optional system prompt to forward to the adapter. */
  systemPrompt?: string;
  /**
   * Upper turn bound for harnesses that iterate. Thin harness ignores this.
   * Applied verbatim to `AgentHarnessRunOptions.maxTurns`.
   */
  maxTurns?: number;
};

export type HarnessParityRunParams = {
  scenario: LoadedScenario;
  harness: AgentHarness;
  callOptions: HarnessParityCallOptions;
  /** Base artifact directory. The runner writes into `<outBaseDir>/<harness.name>/`. */
  outBaseDir: string;
  /** Keep the materialized working directory for post-mortem inspection. */
  keepWorkingDir?: boolean;
};

export type VerificationResult = {
  command: string;
  timeoutMs: number;
  passed: boolean;
  exitStatus: number | null;
  timedOut: boolean;
  output: string;
};

export type HarnessParityArtifact = {
  scenarioId: string;
  harnessName: string;
  model: string;
  /**
   * Reasoning posture the harness actually ran under. Paired artifacts
   * show this alongside `harness` and `model` so an operator comparing
   * adapters can see which reasoning surface (if any) was engaged.
   */
  effort: AgentEffort;
  startedAt: string;
  durationMs: number;
  turns: number;
  isError: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  subtype?: string;
  sessionId?: string;
  verification: VerificationResult;
  /** Static adapter boundary and optional local readiness observed before the run. */
  capability: HarnessCapabilitySnapshot;
  /** Files changed under the working directory relative to the initial tree. */
  changedFiles: readonly string[];
  /** Where artifacts for this harness × scenario run landed. */
  artifactDir: string;
  /** Structured action/observation trajectory captured from `onMessage`. */
  trajectory: HarnessParityTrajectoryMetadata;
};

type CollectingWriter = AgentHarnessWriter & { collected(): string };

export type HarnessParityTrajectoryStatus = "supported" | "unsupported";

export type HarnessParityTrajectoryCounts = {
  frameCount: number;
  toolCallCount: number;
  toolResultCount: number;
  statusCount: number;
  resultCount: number;
  truncatedFrameCount: number;
};

type HarnessParityTrajectoryBaseMetadata = HarnessParityTrajectoryCounts & {
  status: HarnessParityTrajectoryStatus;
  emitsAgentMessageStream: boolean;
  artifactPath: string;
  summaryPath: string;
};

export type HarnessParitySupportedTrajectoryMetadata =
  HarnessParityTrajectoryBaseMetadata & {
    status: "supported";
    emitsAgentMessageStream: true;
  };

export type HarnessParityUnsupportedTrajectoryMetadata =
  HarnessParityTrajectoryBaseMetadata & {
    status: "unsupported";
    emitsAgentMessageStream: false;
    reason: string;
  };

export type HarnessParityTrajectoryMetadata =
  | HarnessParitySupportedTrajectoryMetadata
  | HarnessParityUnsupportedTrajectoryMetadata;

type HarnessParityTrajectoryFrame = {
  index: number;
  type: KotaAgentMessage["type"];
  message: KotaAgentMessage;
  truncatedFields: string[];
  toolName?: string;
};

type SupportedTrajectoryArtifact = {
  version: 1;
  status: "supported";
  emitsAgentMessageStream: true;
  frames: HarnessParityTrajectoryFrame[];
  counts: HarnessParityTrajectoryCounts;
};

type UnsupportedTrajectoryArtifact = {
  version: 1;
  status: "unsupported";
  emitsAgentMessageStream: false;
  reason: string;
  frames: [];
  counts: HarnessParityTrajectoryCounts;
};

type TrajectoryArtifact =
  | SupportedTrajectoryArtifact
  | UnsupportedTrajectoryArtifact;

type SanitizedTrajectoryMessage = {
  message: KotaAgentMessage;
  truncatedFields: string[];
};

type KotaToolResultRichContentBlock = Exclude<
  KotaToolResultBlock["content"],
  string
>[number];

type SanitizedTrajectoryBlock = {
  block: KotaContentBlock;
  truncatedFields: string[];
};

type SanitizedToolResultRichContentBlock = {
  block: KotaToolResultRichContentBlock;
  truncatedFields: string[];
};

type SanitizedJsonValue = {
  value: KotaJsonValue;
  truncatedFields: string[];
};

type SanitizedJsonObject = {
  value: KotaJsonObject;
  truncatedFields: string[];
};

function createCollectingWriter(): CollectingWriter {
  const chunks: string[] = [];
  return {
    write(text: string): boolean {
      chunks.push(text);
      return true;
    },
    collected(): string {
      return chunks.join("");
    },
  };
}

function materializeWorkingDir(scenario: LoadedScenario): string {
  const workingDir = mkdtempSync(
    join(tmpdir(), `kota-harness-parity-${scenario.spec.id}-`),
  );
  cpSync(scenario.initialStateDir, workingDir, { recursive: true });
  return workingDir;
}

function tail(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `[... ${text.length - limit} chars truncated ...]\n${text.slice(-limit)}`;
}

function truncateField(value: string, limit: number): {
  value: string;
  truncated: boolean;
} {
  if (value.length <= limit) return { value, truncated: false };
  return {
    value:
      `${value.slice(0, limit)}\n` +
      `[... ${value.length - limit} chars truncated from trajectory field ...]`,
    truncated: true,
  };
}

function truncateStringField(value: string, path: string): {
  value: string;
  truncatedFields: string[];
} {
  const truncated = truncateField(value, TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT);
  return {
    value: truncated.value,
    truncatedFields: truncated.truncated ? [path] : [],
  };
}

function sanitizeJsonObject(
  value: KotaJsonObject,
  path: string,
): SanitizedJsonObject {
  const object: KotaJsonObject = {};
  const truncatedFields: string[] = [];
  for (const key of Object.keys(value)) {
    const sanitized = sanitizeJsonValue(value[key], `${path}.${key}`);
    object[key] = sanitized.value;
    truncatedFields.push(...sanitized.truncatedFields);
  }
  return { value: object, truncatedFields };
}

function sanitizeJsonValue(
  value: KotaJsonValue,
  path: string,
): SanitizedJsonValue {
  if (typeof value === "string") return truncateStringField(value, path);
  if (Array.isArray(value)) {
    const truncatedFields: string[] = [];
    const values: KotaJsonValue[] = [];
    for (const [index, item] of value.entries()) {
      const sanitized = sanitizeJsonValue(item, `${path}[${index}]`);
      values.push(sanitized.value);
      truncatedFields.push(...sanitized.truncatedFields);
    }
    return { value: values, truncatedFields };
  }
  if (value !== null && typeof value === "object") {
    return sanitizeJsonObject(value, path);
  }
  return { value, truncatedFields: [] };
}

function sanitizeTextBlock(
  block: Extract<KotaContentBlock, { type: "text" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "text" }>;
  truncatedFields: string[];
} {
  const text = truncateStringField(block.text, `${path}.text`);
  return {
    block: { ...block, text: text.value },
    truncatedFields: text.truncatedFields,
  };
}

function sanitizeImageBlock(
  block: Extract<KotaContentBlock, { type: "image" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "image" }>;
  truncatedFields: string[];
} {
  const data = truncateStringField(block.source.data, `${path}.source.data`);
  return {
    block: {
      ...block,
      source: { ...block.source, data: data.value },
    },
    truncatedFields: data.truncatedFields,
  };
}

function sanitizeThinkingBlock(
  block: Extract<KotaContentBlock, { type: "thinking" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "thinking" }>;
  truncatedFields: string[];
} {
  const thinking = truncateStringField(block.thinking, `${path}.thinking`);
  return {
    block: { ...block, thinking: thinking.value },
    truncatedFields: thinking.truncatedFields,
  };
}

function sanitizeMcpContentBlock(
  block: Extract<KotaToolResultRichContentBlock, { type: "mcp_content" }>,
  path: string,
): {
  block: Extract<KotaToolResultRichContentBlock, { type: "mcp_content" }>;
  truncatedFields: string[];
} {
  const mcpContent = block.content;
  if (mcpContent.type === "audio") {
    const data = truncateStringField(mcpContent.data, `${path}.content.data`);
    return {
      block: { ...block, content: { ...mcpContent, data: data.value } },
      truncatedFields: data.truncatedFields,
    };
  }
  if (mcpContent.type === "resource") {
    if ("text" in mcpContent.resource) {
      const text = truncateStringField(
        mcpContent.resource.text,
        `${path}.content.resource.text`,
      );
      return {
        block: {
          ...block,
          content: {
            ...mcpContent,
            resource: { ...mcpContent.resource, text: text.value },
          },
        },
        truncatedFields: text.truncatedFields,
      };
    }
    const blob = truncateStringField(
      mcpContent.resource.blob,
      `${path}.content.resource.blob`,
    );
    return {
      block: {
        ...block,
        content: {
          ...mcpContent,
          resource: { ...mcpContent.resource, blob: blob.value },
        },
      },
      truncatedFields: blob.truncatedFields,
    };
  }
  if (mcpContent.type === "unknown") {
    const raw = sanitizeJsonObject(mcpContent.raw, `${path}.content.raw`);
    return {
      block: { ...block, content: { ...mcpContent, raw: raw.value } },
      truncatedFields: raw.truncatedFields,
    };
  }
  return { block, truncatedFields: [] };
}

function sanitizeToolResultRichContentBlock(
  block: KotaToolResultRichContentBlock,
  path: string,
): SanitizedToolResultRichContentBlock {
  if (block.type === "text") return sanitizeTextBlock(block, path);
  if (block.type === "image") return sanitizeImageBlock(block, path);
  return sanitizeMcpContentBlock(block, path);
}

function sanitizeNestedToolResultBlock(
  block: Extract<KotaContentBlock, { type: "tool_result" }>,
  path: string,
): {
  block: Extract<KotaContentBlock, { type: "tool_result" }>;
  truncatedFields: string[];
} {
  const truncatedFields: string[] = [];
  const content = block.content;
  let sanitizedContent: KotaToolResultBlock["content"];
  if (typeof content === "string") {
    const sanitized = truncateStringField(content, `${path}.content`);
    truncatedFields.push(...sanitized.truncatedFields);
    sanitizedContent = sanitized.value;
  } else {
    const sanitizedBlocks: KotaToolResultRichContentBlock[] = [];
    for (const [index, contentBlock] of content.entries()) {
      const sanitized = sanitizeToolResultRichContentBlock(
        contentBlock,
        `${path}.content[${index}]`,
      );
      sanitizedBlocks.push(sanitized.block);
      truncatedFields.push(...sanitized.truncatedFields);
    }
    sanitizedContent = sanitizedBlocks;
  }

  let sanitizedStructuredContent: SanitizedJsonObject | undefined;
  if (block.structuredContent !== undefined) {
    sanitizedStructuredContent = sanitizeJsonObject(
      block.structuredContent,
      `${path}.structuredContent`,
    );
  }
  let sanitizedMeta: SanitizedJsonObject | undefined;
  if (block._meta !== undefined) {
    sanitizedMeta = sanitizeJsonObject(block._meta, `${path}._meta`);
  }
  if (sanitizedStructuredContent !== undefined) {
    truncatedFields.push(...sanitizedStructuredContent.truncatedFields);
  }
  if (sanitizedMeta !== undefined) {
    truncatedFields.push(...sanitizedMeta.truncatedFields);
  }

  return {
    block: {
      ...block,
      content: sanitizedContent,
      ...(sanitizedStructuredContent !== undefined
        ? { structuredContent: sanitizedStructuredContent.value }
        : {}),
      ...(sanitizedMeta !== undefined ? { _meta: sanitizedMeta.value } : {}),
    },
    truncatedFields,
  };
}

function sanitizeTrajectoryContentBlock(
  block: KotaContentBlock,
  path: string,
): SanitizedTrajectoryBlock {
  if (block.type === "text") return sanitizeTextBlock(block, path);
  if (block.type === "image") return sanitizeImageBlock(block, path);
  if (block.type === "tool_result") {
    return sanitizeNestedToolResultBlock(block, path);
  }
  if (block.type === "thinking") return sanitizeThinkingBlock(block, path);
  return { block, truncatedFields: [] };
}

function sanitizeToolResultMessage(
  message: Extract<KotaAgentMessage, { type: "tool_result" }>,
): SanitizedTrajectoryMessage {
  const truncatedFields: string[] = [];
  if (typeof message.content === "string") {
    const content = truncateField(
      message.content,
      TRAJECTORY_TOOL_RESULT_CONTENT_LIMIT,
    );
    if (content.truncated) truncatedFields.push("content");
    return {
      message: { ...message, content: content.value },
      truncatedFields,
    };
  }

  const content: KotaContentBlock[] = [];
  for (const [index, block] of message.content.entries()) {
    const sanitized = sanitizeTrajectoryContentBlock(
      block,
      `content[${index}]`,
    );
    content.push(sanitized.block);
    truncatedFields.push(...sanitized.truncatedFields);
  }
  return {
    message: { ...message, content },
    truncatedFields,
  };
}

function sanitizeTrajectoryMessage(
  message: KotaAgentMessage,
): SanitizedTrajectoryMessage {
  if (message.type === "tool_result") return sanitizeToolResultMessage(message);
  return { message, truncatedFields: [] };
}

function emptyTrajectoryCounts(): HarnessParityTrajectoryCounts {
  return {
    frameCount: 0,
    toolCallCount: 0,
    toolResultCount: 0,
    statusCount: 0,
    resultCount: 0,
    truncatedFrameCount: 0,
  };
}

function countTrajectoryFrames(
  frames: readonly HarnessParityTrajectoryFrame[],
): HarnessParityTrajectoryCounts {
  return {
    frameCount: frames.length,
    toolCallCount: frames.filter((frame) => frame.type === "tool_call").length,
    toolResultCount: frames.filter((frame) => frame.type === "tool_result").length,
    statusCount: frames.filter((frame) => frame.type === "status").length,
    resultCount: frames.filter((frame) => frame.type === "result").length,
    truncatedFrameCount: frames.filter(
      (frame) => frame.truncatedFields.length > 0,
    ).length,
  };
}

function buildTrajectoryFrames(
  messages: readonly KotaAgentMessage[],
): HarnessParityTrajectoryFrame[] {
  const toolNamesByUseId = new Map<string, string>();
  return messages.map((rawMessage, index) => {
    const sanitized = sanitizeTrajectoryMessage(rawMessage);
    const frame: HarnessParityTrajectoryFrame = {
      index,
      type: sanitized.message.type,
      message: sanitized.message,
      truncatedFields: sanitized.truncatedFields,
    };
    if (sanitized.message.type === "tool_call") {
      toolNamesByUseId.set(
        sanitized.message.toolUseId,
        sanitized.message.toolName,
      );
      frame.toolName = sanitized.message.toolName;
    }
    if (sanitized.message.type === "tool_result") {
      const toolName = toolNamesByUseId.get(sanitized.message.toolUseId);
      if (toolName !== undefined) frame.toolName = toolName;
    }
    return frame;
  });
}

function buildSupportedTrajectoryArtifact(
  frames: readonly HarnessParityTrajectoryFrame[],
): SupportedTrajectoryArtifact {
  return {
    version: 1,
    status: "supported",
    emitsAgentMessageStream: true,
    frames: [...frames],
    counts: countTrajectoryFrames(frames),
  };
}

function buildUnsupportedTrajectoryArtifact(reason: string): UnsupportedTrajectoryArtifact {
  return {
    version: 1,
    status: "unsupported",
    emitsAgentMessageStream: false,
    reason,
    frames: [],
    counts: emptyTrajectoryCounts(),
  };
}

function writeTrajectoryArtifacts(args: {
  artifactDir: string;
  capability: HarnessCapabilitySnapshot;
  messages: readonly KotaAgentMessage[];
}): HarnessParityTrajectoryMetadata {
  const artifactPath = join(args.artifactDir, TRAJECTORY_ARTIFACT_NAME);
  const summaryPath = join(args.artifactDir, TRAJECTORY_SUMMARY_NAME);
  if (!args.capability.emitsAgentMessageStream) {
    const reason =
      "Harness capability snapshot declares emitsAgentMessageStream=false.";
    const artifact = buildUnsupportedTrajectoryArtifact(reason);
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    writeFileSync(summaryPath, buildTrajectorySummary(artifact));
    return {
      status: "unsupported",
      emitsAgentMessageStream: false,
      artifactPath,
      summaryPath,
      reason,
      ...artifact.counts,
    };
  }

  const artifact = buildSupportedTrajectoryArtifact(
    buildTrajectoryFrames(args.messages),
  );
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  writeFileSync(summaryPath, buildTrajectorySummary(artifact));
  return {
    status: "supported",
    emitsAgentMessageStream: true,
    artifactPath,
    summaryPath,
    ...artifact.counts,
  };
}

function buildTrajectorySummary(artifact: TrajectoryArtifact): string {
  const lines: string[] = [];
  lines.push("# Trajectory");
  lines.push("");
  lines.push(`- status: ${artifact.status}`);
  lines.push(
    `- emitsAgentMessageStream: ${artifact.emitsAgentMessageStream}`,
  );
  if (artifact.status === "unsupported") {
    lines.push(`- reason: ${artifact.reason}`);
  }
  lines.push(`- frames: ${artifact.counts.frameCount}`);
  lines.push(`- toolCalls: ${artifact.counts.toolCallCount}`);
  lines.push(`- toolResults: ${artifact.counts.toolResultCount}`);
  lines.push(`- statusFrames: ${artifact.counts.statusCount}`);
  lines.push(`- resultFrames: ${artifact.counts.resultCount}`);
  lines.push(`- truncatedFrames: ${artifact.counts.truncatedFrameCount}`);
  if (artifact.status === "unsupported") return `${lines.join("\n")}\n`;

  lines.push("");
  lines.push("## Sequence");
  lines.push("");
  if (artifact.frames.length === 0) {
    lines.push("- no frames captured");
    return `${lines.join("\n")}\n`;
  }

  for (const frame of artifact.frames) {
    lines.push(`- ${formatTrajectoryFrame(frame)}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatTrajectoryFrame(frame: HarnessParityTrajectoryFrame): string {
  const truncated =
    frame.truncatedFields.length > 0
      ? ` truncated=${frame.truncatedFields.join(",")}`
      : "";
  if (frame.message.type === "tool_call") {
    return `${frame.index}. tool_call ${frame.message.toolName} (${frame.message.toolUseId})${truncated}`;
  }
  if (frame.message.type === "tool_result") {
    const tool = frame.toolName !== undefined ? ` ${frame.toolName}` : "";
    return `${frame.index}. tool_result${tool} (${frame.message.toolUseId}) isError=${frame.message.isError}${truncated}`;
  }
  if (frame.message.type === "status") {
    return `${frame.index}. status ${frame.message.category}${truncated}`;
  }
  if (frame.message.type === "result") {
    return `${frame.index}. result isError=${frame.message.isError}${truncated}`;
  }
  return `${frame.index}. ${frame.message.type}${truncated}`;
}

function runVerification(
  workingDir: string,
  verification: ScenarioVerification,
): VerificationResult {
  const result = spawnSync(verification.command, {
    shell: true,
    cwd: workingDir,
    timeout: verification.timeoutMs,
    encoding: "utf-8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const timedOut =
    result.signal === "SIGTERM" || result.error?.message.includes("ETIMEDOUT") === true;
  const passed = !timedOut && result.status === 0;
  const combined = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    command: verification.command,
    timeoutMs: verification.timeoutMs,
    passed,
    exitStatus: result.status ?? null,
    timedOut,
    output: tail(combined, TRACE_TAIL_LIMIT),
  };
}

/**
 * Compute a git-style diff of the working directory vs the scenario initial
 * tree. The two trees are placed under a shared parent so git diff renders
 * paths as `a/initial/...` vs `b/working/...`, keeping the output stable
 * regardless of where the real directories live.
 */
function computeDiff(initialDir: string, workingDir: string): {
  diff: string;
  changedFiles: string[];
} {
  const pairDir = mkdtempSync(join(tmpdir(), "kota-harness-parity-pair-"));
  const initialLink = join(pairDir, "initial");
  const workingLink = join(pairDir, "working");
  cpSync(initialDir, initialLink, { recursive: true });
  cpSync(workingDir, workingLink, { recursive: true });

  const diffResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--no-color",
      "--unified=3",
      "initial",
      "working",
    ],
    {
      cwd: pairDir,
      encoding: "utf-8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  const diffCombined = [diffResult.stdout, diffResult.stderr]
    .filter(Boolean)
    .join("\n");

  const namesResult = spawnSync(
    "git",
    [
      "diff",
      "--no-index",
      "--name-only",
      "initial",
      "working",
    ],
    {
      cwd: pairDir,
      encoding: "utf-8",
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const changed = new Set<string>();
  for (const line of (namesResult.stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const stripped = trimmed.startsWith("working/")
      ? trimmed.slice("working/".length)
      : trimmed.startsWith("initial/")
        ? trimmed.slice("initial/".length)
        : trimmed;
    if (stripped.length > 0) changed.add(stripped);
  }

  rmSync(pairDir, { recursive: true, force: true });

  return {
    diff: tail(diffCombined, DIFF_TAIL_LIMIT),
    changedFiles: [...changed].sort(),
  };
}

/**
 * Run one scenario through one harness. The caller is responsible for
 * resolving the harness from the registry; this function stays oblivious to
 * which adapters exist so it can be reused by both CLI and tests.
 */
export async function runScenarioOnHarness(
  params: HarnessParityRunParams,
): Promise<HarnessParityArtifact> {
  const { scenario, harness, callOptions } = params;
  const artifactDir = join(params.outBaseDir, harness.name);
  mkdirSync(artifactDir, { recursive: true });

  const capability = buildHarnessCapabilitySnapshot(harness);
  const workingDir = materializeWorkingDir(scenario);
  const writer = createCollectingWriter();
  const trajectoryMessages: KotaAgentMessage[] = [];
  const startedAt = new Date();
  const startMs = startedAt.getTime();

  let runError: Error | null = null;
  let runResult: Awaited<ReturnType<typeof runAgentHarness>> | null = null;
  const effort: AgentEffort = DEFAULT_EFFORT;
  try {
    const runOptions: AgentHarnessRunOptions = {
      prompt: scenario.spec.prompt,
      model: callOptions.model,
      cwd: workingDir,
      effort,
      ...(callOptions.systemPrompt !== undefined
        ? { systemPrompt: callOptions.systemPrompt }
        : {}),
      ...(callOptions.maxTurns !== undefined
        ? { maxTurns: callOptions.maxTurns }
        : {}),
      ...(capability.emitsAgentMessageStream
        ? {
            onMessage(message) {
              trajectoryMessages.push(message);
            },
          }
        : {}),
    };
    runResult = await runAgentHarness(
      harness,
      runOptions,
      writer,
    );
  } catch (err) {
    runError = err instanceof Error ? err : new Error(String(err));
  }

  const durationMs = Date.now() - startMs;
  const { diff, changedFiles } = computeDiff(
    scenario.initialStateDir,
    workingDir,
  );
  const verification = runVerification(workingDir, scenario.spec.verification);

  writeFileSync(join(artifactDir, "prompt.txt"), scenario.spec.prompt);
  writeFileSync(join(artifactDir, "diff.patch"), diff);
  writeFileSync(
    join(artifactDir, "verification.json"),
    JSON.stringify(verification, null, 2),
  );
  writeFileSync(
    join(artifactDir, "trace.txt"),
    tail(writer.collected(), TRACE_TAIL_LIMIT),
  );
  const trajectory = writeTrajectoryArtifacts({
    artifactDir,
    capability,
    messages: trajectoryMessages,
  });

  const artifact: HarnessParityArtifact = {
    scenarioId: scenario.spec.id,
    harnessName: harness.name,
    model: callOptions.model,
    effort,
    startedAt: startedAt.toISOString(),
    durationMs,
    turns: runResult?.turns ?? 0,
    isError: runError !== null || runResult?.isError === true,
    verification,
    capability,
    changedFiles,
    artifactDir,
    trajectory,
    ...(runResult?.inputTokens !== undefined
      ? { inputTokens: runResult.inputTokens }
      : {}),
    ...(runResult?.outputTokens !== undefined
      ? { outputTokens: runResult.outputTokens }
      : {}),
    ...(runResult?.totalCostUsd !== undefined
      ? { totalCostUsd: runResult.totalCostUsd }
      : {}),
    ...(runResult?.subtype !== undefined ? { subtype: runResult.subtype } : {}),
    ...(runResult?.sessionId !== undefined ? { sessionId: runResult.sessionId } : {}),
  };

  writeFileSync(
    join(artifactDir, "run-meta.json"),
    JSON.stringify(
      {
        ...artifact,
        workingDir,
        error: runError
          ? { message: runError.message, stack: runError.stack }
          : null,
      },
      null,
      2,
    ),
  );

  writeFileSync(
    join(artifactDir, "trace-summary.md"),
    buildTraceSummary(artifact, runError, writer.collected()),
  );

  if (!params.keepWorkingDir) {
    rmSync(workingDir, { recursive: true, force: true });
  }

  return artifact;
}

function buildTraceSummary(
  artifact: HarnessParityArtifact,
  runError: Error | null,
  streamedText: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${artifact.harnessName} — ${artifact.scenarioId}`);
  lines.push("");
  lines.push(`- model: ${artifact.model}`);
  lines.push(`- effort: ${artifact.effort}`);
  lines.push(`- startedAt: ${artifact.startedAt}`);
  lines.push(`- durationMs: ${artifact.durationMs}`);
  lines.push(`- turns: ${artifact.turns}`);
  lines.push(`- isError: ${artifact.isError}`);
  if (artifact.subtype !== undefined) lines.push(`- subtype: ${artifact.subtype}`);
  if (artifact.inputTokens !== undefined) {
    lines.push(`- inputTokens: ${artifact.inputTokens}`);
  }
  if (artifact.outputTokens !== undefined) {
    lines.push(`- outputTokens: ${artifact.outputTokens}`);
  }
  if (artifact.totalCostUsd !== undefined) {
    lines.push(`- totalCostUsd: ${artifact.totalCostUsd}`);
  }
  lines.push(
    `- verification: ${artifact.verification.passed ? "pass" : "fail"} (exit ${artifact.verification.exitStatus ?? "null"}${artifact.verification.timedOut ? ", timeout" : ""})`,
  );
  lines.push(`- changedFiles (${artifact.changedFiles.length}):`);
  for (const path of artifact.changedFiles) lines.push(`  - ${path}`);
  lines.push("");
  lines.push("## Capability boundary");
  lines.push("");
  renderCapabilityBoundary(lines, artifact.capability);
  if (runError) {
    lines.push("");
    lines.push("## Run error");
    lines.push("");
    lines.push("```");
    lines.push(runError.message);
    lines.push("```");
  }
  lines.push("");
  lines.push("## Streamed text (tail)");
  lines.push("");
  lines.push("```");
  lines.push(tail(streamedText, 8_000));
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

function renderCapabilityBoundary(
  lines: string[],
  capability: HarnessCapabilitySnapshot,
): void {
  lines.push(`- toolControl: ${capability.toolControl}`);
  lines.push(`- supportsMultiTurn: ${capability.supportsMultiTurn}`);
  lines.push(
    `- ownerQuestions: ${
      capability.askOwnerToolName === null
        ? "unsupported"
        : `supported (${capability.askOwnerToolName})`
    }`,
  );
  lines.push(
    `- emitsAgentMessageStream: ${capability.emitsAgentMessageStream}`,
  );
  lines.push(
    `- supportedHookKinds: ${capability.supportedHookKinds.join(", ") || "none"}`,
  );
  lines.push(
    `- unsupportedRunOptions (${capability.unsupportedRunOptions.length}):`,
  );
  if (capability.unsupportedRunOptions.length === 0) {
    lines.push("  - none");
  } else {
    for (const entry of capability.unsupportedRunOptions) {
      const runOption =
        entry.runOption !== undefined ? ` [${entry.runOption}]` : "";
      lines.push(`  - ${entry.option}${runOption}: ${entry.reason}`);
    }
  }
  if (capability.localReadiness === undefined) {
    lines.push("- localReadiness: not declared");
    return;
  }

  lines.push(
    `- localReadiness: ${capability.localReadiness.adapterKind}`,
  );
  lines.push(
    `  - runtime: ${capability.localReadiness.localRuntime.status} - ${capability.localReadiness.localRuntime.summary}`,
  );
  if (capability.localReadiness.localAuth !== undefined) {
    lines.push(
      `  - auth: ${capability.localReadiness.localAuth.status} - ${capability.localReadiness.localAuth.summary}`,
    );
  }
  if (capability.localReadiness.optionalRuntimes.length > 0) {
    lines.push("  - optionalRuntimes:");
    for (const runtime of capability.localReadiness.optionalRuntimes) {
      lines.push(`    - ${runtime.status} - ${runtime.summary}`);
    }
  }
}

/**
 * Run one scenario across every harness in `harnesses`, in order. Writes a
 * combined `parity.json` under `outBaseDir/<scenario.id>/` summarizing the
 * paired outcomes and returns every per-harness artifact.
 */
export async function runScenarioAcrossHarnesses(params: {
  scenario: LoadedScenario;
  harnesses: readonly AgentHarness[];
  callOptions: HarnessParityCallOptions;
  outBaseDir: string;
  keepWorkingDir?: boolean;
}): Promise<HarnessParityArtifact[]> {
  const scenarioBaseDir = join(params.outBaseDir, params.scenario.spec.id);
  mkdirSync(scenarioBaseDir, { recursive: true });

  const artifacts: HarnessParityArtifact[] = [];
  for (const harness of params.harnesses) {
    const artifact = await runScenarioOnHarness({
      scenario: params.scenario,
      harness,
      callOptions: params.callOptions,
      outBaseDir: scenarioBaseDir,
      ...(params.keepWorkingDir !== undefined
        ? { keepWorkingDir: params.keepWorkingDir }
        : {}),
    });
    artifacts.push(artifact);
  }

  writeFileSync(
    join(scenarioBaseDir, "parity.json"),
    JSON.stringify(
      {
        scenarioId: params.scenario.spec.id,
        model: params.callOptions.model,
        artifacts: artifacts.map((a) => ({
          harnessName: a.harnessName,
          effort: a.effort,
          durationMs: a.durationMs,
          turns: a.turns,
          verificationPassed: a.verification.passed,
          changedFiles: a.changedFiles,
          isError: a.isError,
          capability: summarizeHarnessCapability(a.capability),
          trajectory: a.trajectory,
          totalCostUsd: a.totalCostUsd,
          inputTokens: a.inputTokens,
          outputTokens: a.outputTokens,
          artifactDir: a.artifactDir,
        })),
      },
      null,
      2,
    ),
  );

  return artifacts;
}
