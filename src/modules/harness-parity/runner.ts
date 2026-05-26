/**
 * Execute a coding-task scenario against a single `AgentHarness` and capture
 * paired artifacts for operator review. Reuses the existing `runAgentHarness`
 * entry point the CLI already calls — there is no second benchmarking path.
 *
 * Artifacts land under `<outBaseDir>/<harnessName>/` so every harness result
 * for a scenario is side-by-side in one directory.
 */

import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AgentEffort,
  AgentHarness,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  HarnessCapabilitySnapshot,
  KotaAgentMessage,
  KotaContentBlock,
  KotaToolResultBlock,
} from "#core/agent-harness/index.js";
import {
  buildHarnessCapabilitySnapshot,
  runAgentHarness,
  summarizeHarnessCapability,
} from "#core/agent-harness/index.js";
import type {
  KotaJsonObject,
  KotaJsonValue,
} from "#core/agent-harness/message-protocol.js";
import type {
  LoadedScenario,
  ScenarioStageSpec,
  ScenarioVerification,
} from "./scenario.js";
import {
  aggregateTrajectoryDiagnosticsMetadata,
  buildTrajectoryDiagnosticsArtifact,
  type HarnessParityTrajectoryDiagnosticsMetadata,
  TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  trajectoryDiagnosticsMetadata,
} from "./trajectory-diagnostics.js";

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

export type PreviewArtifactResult =
  | {
      sourcePath: string;
      artifactPath: string;
      preserved: true;
    }
  | {
      sourcePath: string;
      artifactPath: string;
      preserved: false;
      reason: "missing" | "not_file";
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
  /** Declared operator preview artifacts copied after verification, if any. */
  previewArtifacts: readonly PreviewArtifactResult[];
  /** Where artifacts for this harness × scenario run landed. */
  artifactDir: string;
  /** Structured action/observation trajectory captured from `onMessage`. */
  trajectory: HarnessParityTrajectoryMetadata;
  /** Advisory process-quality diagnostics derived from structured trajectory frames. */
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
  /** Original scenario execution mode. */
  stageMode: "single" | "staged";
  /** Ordered stage artifacts. Single-stage scenarios contain one `main` stage. */
  stages: readonly HarnessParityStageArtifact[];
  /** Compact per-stage status used by run-meta.json and parity.json. */
  stagedSummary: HarnessParityStagedSummary;
};

export type HarnessParityStageArtifact = {
  stageId: string;
  scenarioId: string;
  harnessName: string;
  model: string;
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
  capability: HarnessCapabilitySnapshot;
  changedFiles: readonly string[];
  previewArtifacts: readonly PreviewArtifactResult[];
  artifactDir: string;
  trajectory: HarnessParityTrajectoryMetadata;
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
};

export type HarnessParityStageSummary = {
  stageId: string;
  verificationPassed: boolean;
  changedFiles: readonly string[];
  isError: boolean;
  turns: number;
  durationMs: number;
  artifactDir: string;
  previewArtifacts: readonly PreviewArtifactResult[];
  trajectory: HarnessParityTrajectoryMetadata;
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
};

export type HarnessParityStagedSummary = {
  mode: "single" | "staged";
  passed: boolean;
  stageCount: number;
  stages: readonly HarnessParityStageSummary[];
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

type WrittenTrajectoryArtifacts = {
  trajectory: HarnessParityTrajectoryMetadata;
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
};

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

type HarnessParityStageRunRecord = HarnessParityStageArtifact & {
  diff: string;
  runError: Error | null;
  streamedText: string;
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
  changedFiles: readonly string[];
  verification: ScenarioVerification;
}): WrittenTrajectoryArtifacts {
  const artifactPath = join(args.artifactDir, TRAJECTORY_ARTIFACT_NAME);
  const summaryPath = join(args.artifactDir, TRAJECTORY_SUMMARY_NAME);
  const diagnosticsPath = join(
    args.artifactDir,
    TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME,
  );
  const diagnosticsArtifact = buildTrajectoryDiagnosticsArtifact({
    capability: args.capability,
    messages: args.messages,
    changedFiles: args.changedFiles,
    verificationCommand: args.verification.command,
  });
  writeFileSync(diagnosticsPath, JSON.stringify(diagnosticsArtifact, null, 2));
  const trajectoryDiagnostics = trajectoryDiagnosticsMetadata(
    diagnosticsArtifact,
    diagnosticsPath,
  );

  if (!args.capability.emitsAgentMessageStream) {
    const reason =
      "Harness capability snapshot declares emitsAgentMessageStream=false.";
    const artifact = buildUnsupportedTrajectoryArtifact(reason);
    writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
    writeFileSync(
      summaryPath,
      buildTrajectorySummary(artifact, trajectoryDiagnostics),
    );
    return {
      trajectory: {
        status: "unsupported",
        emitsAgentMessageStream: false,
        artifactPath,
        summaryPath,
        reason,
        ...artifact.counts,
      },
      trajectoryDiagnostics,
    };
  }

  const artifact = buildSupportedTrajectoryArtifact(
    buildTrajectoryFrames(args.messages),
  );
  writeFileSync(artifactPath, JSON.stringify(artifact, null, 2));
  writeFileSync(
    summaryPath,
    buildTrajectorySummary(artifact, trajectoryDiagnostics),
  );
  return {
    trajectory: {
      status: "supported",
      emitsAgentMessageStream: true,
      artifactPath,
      summaryPath,
      ...artifact.counts,
    },
    trajectoryDiagnostics,
  };
}

function buildTrajectorySummary(
  artifact: TrajectoryArtifact,
  diagnostics: HarnessParityTrajectoryDiagnosticsMetadata,
): string {
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
  renderTrajectoryDiagnosticsSummary(lines, diagnostics);
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

function renderTrajectoryDiagnosticsSummary(
  lines: string[],
  diagnostics: HarnessParityTrajectoryDiagnosticsMetadata,
): void {
  lines.push(`- diagnosticWarnings: ${diagnostics.warningCount}`);
  lines.push(`- diagnosticsArtifact: ${diagnostics.artifactPath}`);
  lines.push(
    `- diagnosticCounts: unsupported=${diagnostics.unsupportedTrajectoryCount}, missingFrames=${diagnostics.missingStreamingFramesCount}, missingFinalVerification=${diagnostics.missingFinalVerificationAfterEditCount}, repeatedFailingCommand=${diagnostics.repeatedIdenticalFailingCommandCount}, editAfterPass=${diagnostics.editAfterSuccessfulVerificationCount}, longPreamble=${diagnostics.longPreambleWithoutTaskTouchCount}`,
  );
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

function capturePreviewArtifacts(args: {
  workingDir: string;
  artifactDir: string;
  previewArtifacts: readonly string[];
}): PreviewArtifactResult[] {
  const results: PreviewArtifactResult[] = [];
  for (const sourcePath of args.previewArtifacts) {
    const source = join(args.workingDir, sourcePath);
    const artifactPath = join(args.artifactDir, sourcePath);
    if (!existsSync(source)) {
      results.push({
        sourcePath,
        artifactPath,
        preserved: false,
        reason: "missing",
      });
      continue;
    }
    if (!statSync(source).isFile()) {
      results.push({
        sourcePath,
        artifactPath,
        preserved: false,
        reason: "not_file",
      });
      continue;
    }

    mkdirSync(dirname(artifactPath), { recursive: true });
    cpSync(source, artifactPath);
    results.push({ sourcePath, artifactPath, preserved: true });
  }
  return results;
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
 * Run one prompt stage through one harness against an already-materialized
 * working tree. Staged scenarios call this repeatedly with the same working
 * directory so each release-note prompt inherits earlier edits.
 */
async function runScenarioStageOnHarness(args: {
  scenario: LoadedScenario;
  stage: ScenarioStageSpec;
  harness: AgentHarness;
  callOptions: HarnessParityCallOptions;
  artifactDir: string;
  capability: HarnessCapabilitySnapshot;
  workingDir: string;
  effort: AgentEffort;
}): Promise<HarnessParityStageRunRecord> {
  const { scenario, stage, harness, callOptions, artifactDir, capability } = args;
  mkdirSync(artifactDir, { recursive: true });
  const writer = createCollectingWriter();
  const trajectoryMessages: KotaAgentMessage[] = [];
  const startedAt = new Date();
  const startMs = startedAt.getTime();

  let runError: Error | null = null;
  let runResult: Awaited<ReturnType<typeof runAgentHarness>> | null = null;
  try {
    const runOptions: AgentHarnessRunOptions = {
      prompt: stage.prompt,
      model: callOptions.model,
      cwd: args.workingDir,
      effort: args.effort,
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
    args.workingDir,
  );
  const verification = runVerification(args.workingDir, stage.verification);
  const previewArtifacts = capturePreviewArtifacts({
    workingDir: args.workingDir,
    artifactDir,
    previewArtifacts: stage.previewArtifacts,
  });

  writeFileSync(join(artifactDir, "prompt.txt"), stage.prompt);
  writeFileSync(join(artifactDir, "diff.patch"), diff);
  writeFileSync(
    join(artifactDir, "verification.json"),
    JSON.stringify(verification, null, 2),
  );
  writeFileSync(
    join(artifactDir, "trace.txt"),
    tail(writer.collected(), TRACE_TAIL_LIMIT),
  );
  const { trajectory, trajectoryDiagnostics } = writeTrajectoryArtifacts({
    artifactDir,
    capability,
    messages: trajectoryMessages,
    changedFiles,
    verification: stage.verification,
  });

  const artifact: HarnessParityStageArtifact = {
    stageId: stage.id,
    scenarioId: scenario.spec.id,
    harnessName: harness.name,
    model: callOptions.model,
    effort: args.effort,
    startedAt: startedAt.toISOString(),
    durationMs,
    turns: runResult?.turns ?? 0,
    isError: runError !== null || runResult?.isError === true,
    verification,
    capability,
    changedFiles,
    previewArtifacts,
    artifactDir,
    trajectory,
    trajectoryDiagnostics,
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
        workingDir: args.workingDir,
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

  return {
    ...artifact,
    diff,
    runError,
    streamedText: writer.collected(),
  };
}

function buildAggregateVerification(
  stageRecords: readonly HarnessParityStageRunRecord[],
): VerificationResult {
  const passed = stageRecords.every((stage) => stage.verification.passed);
  return {
    command: stageRecords
      .map((stage) => `${stage.stageId}: ${stage.verification.command}`)
      .join(" && "),
    timeoutMs: stageRecords.reduce(
      (sum, stage) => sum + stage.verification.timeoutMs,
      0,
    ),
    passed,
    exitStatus: passed ? 0 : 1,
    timedOut: stageRecords.some((stage) => stage.verification.timedOut),
    output: tail(
      stageRecords
        .map(
          (stage) =>
            `[${stage.stageId}] ${stage.verification.passed ? "pass" : "fail"} exit=${stage.verification.exitStatus ?? "null"}${stage.verification.timedOut ? " timeout" : ""}\n${stage.verification.output}`,
        )
        .join("\n\n"),
      TRACE_TAIL_LIMIT,
    ),
  };
}

function buildStagedSummary(
  mode: "single" | "staged",
  stages: readonly HarnessParityStageArtifact[],
): HarnessParityStagedSummary {
  return {
    mode,
    passed: stages.every((stage) => stage.verification.passed),
    stageCount: stages.length,
    stages: stages.map((stage) => ({
      stageId: stage.stageId,
      verificationPassed: stage.verification.passed,
      changedFiles: stage.changedFiles,
      isError: stage.isError,
      turns: stage.turns,
      durationMs: stage.durationMs,
      artifactDir: stage.artifactDir,
      previewArtifacts: stage.previewArtifacts,
      trajectory: stage.trajectory,
      trajectoryDiagnostics: stage.trajectoryDiagnostics,
    })),
  };
}

function sumOptionalNumber(
  stages: readonly HarnessParityStageArtifact[],
  getValue: (stage: HarnessParityStageArtifact) => number | undefined,
): number | undefined {
  const values = stages
    .map((stage) => getValue(stage))
    .filter((value): value is number => value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0);
}

function buildStagedPromptText(stages: readonly ScenarioStageSpec[]): string {
  return `${stages
    .map((stage) => `## ${stage.id}\n\n${stage.prompt}`)
    .join("\n\n")}\n`;
}

function buildStagedTraceSummary(artifact: HarnessParityArtifact): string {
  const lines: string[] = [];
  lines.push(`# ${artifact.harnessName} — ${artifact.scenarioId}`);
  lines.push("");
  lines.push(`- model: ${artifact.model}`);
  lines.push(`- effort: ${artifact.effort}`);
  lines.push(`- stageMode: ${artifact.stageMode}`);
  lines.push(`- stages: ${artifact.stages.length}`);
  lines.push(`- startedAt: ${artifact.startedAt}`);
  lines.push(`- durationMs: ${artifact.durationMs}`);
  lines.push(`- turns: ${artifact.turns}`);
  lines.push(`- isError: ${artifact.isError}`);
  lines.push(
    `- verification: ${artifact.verification.passed ? "pass" : "fail"} (${artifact.stages.filter((stage) => stage.verification.passed).length}/${artifact.stages.length} stages passed)`,
  );
  lines.push(
    `- trajectoryDiagnostics: warnings=${artifact.trajectoryDiagnostics.warningCount}, artifact=${artifact.trajectoryDiagnostics.artifactPath}`,
  );
  lines.push(`- changedFiles (${artifact.changedFiles.length}):`);
  for (const path of artifact.changedFiles) lines.push(`  - ${path}`);
  lines.push("");
  lines.push("## Stages");
  lines.push("");
  for (const stage of artifact.stages) {
    lines.push(
      `- ${stage.stageId}: ${stage.verification.passed ? "pass" : "fail"} (exit ${stage.verification.exitStatus ?? "null"}${stage.verification.timedOut ? ", timeout" : ""}), turns=${stage.turns}, changedFiles=${stage.changedFiles.length}, diagnosticWarnings=${stage.trajectoryDiagnostics.warningCount}`,
    );
    lines.push(`  - artifacts: ${stage.artifactDir}`);
    lines.push(`  - diagnostics: ${stage.trajectoryDiagnostics.artifactPath}`);
  }
  lines.push("");
  lines.push("## Capability boundary");
  lines.push("");
  renderCapabilityBoundary(lines, artifact.capability);
  return `${lines.join("\n")}\n`;
}

function buildStagedTrajectorySummary(artifact: HarnessParityArtifact): string {
  const lines: string[] = [];
  lines.push("# Staged Trajectory");
  lines.push("");
  lines.push(`- status: staged`);
  lines.push(`- stages: ${artifact.stages.length}`);
  lines.push(
    `- emitsAgentMessageStream: ${artifact.capability.emitsAgentMessageStream}`,
  );
  renderTrajectoryDiagnosticsSummary(lines, artifact.trajectoryDiagnostics);
  for (const stage of artifact.stages) {
    lines.push(
      `- ${stage.stageId}: ${stage.trajectory.status}, frames=${stage.trajectory.frameCount}, diagnostics=${stage.trajectoryDiagnostics.warningCount}, artifact=${stage.trajectory.artifactPath}`,
    );
  }
  return `${lines.join("\n")}\n`;
}

function writeStagedTrajectoryArtifacts(artifact: HarnessParityArtifact): void {
  writeFileSync(
    join(artifact.artifactDir, TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME),
    JSON.stringify(
      {
        version: 1,
        status: "staged",
        counts: {
          warningCount: artifact.trajectoryDiagnostics.warningCount,
          unsupportedTrajectoryCount:
            artifact.trajectoryDiagnostics.unsupportedTrajectoryCount,
          missingStreamingFramesCount:
            artifact.trajectoryDiagnostics.missingStreamingFramesCount,
          missingFinalVerificationAfterEditCount:
            artifact.trajectoryDiagnostics
              .missingFinalVerificationAfterEditCount,
          repeatedIdenticalFailingCommandCount:
            artifact.trajectoryDiagnostics.repeatedIdenticalFailingCommandCount,
          editAfterSuccessfulVerificationCount:
            artifact.trajectoryDiagnostics.editAfterSuccessfulVerificationCount,
          longPreambleWithoutTaskTouchCount:
            artifact.trajectoryDiagnostics.longPreambleWithoutTaskTouchCount,
        },
        stages: artifact.stages.map((stage) => ({
          stageId: stage.stageId,
          diagnostics: stage.trajectoryDiagnostics,
        })),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(artifact.artifactDir, TRAJECTORY_ARTIFACT_NAME),
    JSON.stringify(
      {
        version: 1,
        status: "staged",
        emitsAgentMessageStream: artifact.capability.emitsAgentMessageStream,
        stages: artifact.stages.map((stage) => ({
          stageId: stage.stageId,
          trajectory: stage.trajectory,
        })),
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(artifact.artifactDir, TRAJECTORY_SUMMARY_NAME),
    buildStagedTrajectorySummary(artifact),
  );
}

function buildHarnessArtifact(args: {
  scenario: LoadedScenario;
  harness: AgentHarness;
  callOptions: HarnessParityCallOptions;
  artifactDir: string;
  workingDir: string;
  capability: HarnessCapabilitySnapshot;
  stageRecords: readonly HarnessParityStageRunRecord[];
  startedAt: Date;
  durationMs: number;
}): HarnessParityArtifact {
  const stages: readonly HarnessParityStageArtifact[] = args.stageRecords.map(
    ({ diff: _diff, runError: _runError, streamedText: _streamedText, ...stage }) =>
      stage,
  );
  const finalStage = stages[stages.length - 1]!;
  const verification =
    args.scenario.spec.stageMode === "single"
      ? finalStage.verification
      : buildAggregateVerification(args.stageRecords);
  const stagedSummary = buildStagedSummary(args.scenario.spec.stageMode, stages);
  const trajectoryDiagnostics =
    args.scenario.spec.stageMode === "single"
      ? finalStage.trajectoryDiagnostics
      : aggregateTrajectoryDiagnosticsMetadata(
          stages.map((stage) => stage.trajectoryDiagnostics),
          join(args.artifactDir, TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME),
        );

  return {
    scenarioId: args.scenario.spec.id,
    harnessName: args.harness.name,
    model: args.callOptions.model,
    effort: DEFAULT_EFFORT,
    startedAt: args.startedAt.toISOString(),
    durationMs: args.durationMs,
    turns: stages.reduce((sum, stage) => sum + stage.turns, 0),
    isError: stages.some((stage) => stage.isError),
    verification,
    capability: args.capability,
    changedFiles: finalStage.changedFiles,
    previewArtifacts: finalStage.previewArtifacts,
    artifactDir: args.artifactDir,
    trajectory: finalStage.trajectory,
    trajectoryDiagnostics,
    stageMode: args.scenario.spec.stageMode,
    stages,
    stagedSummary,
    ...(sumOptionalNumber(stages, (stage) => stage.inputTokens) !== undefined
      ? { inputTokens: sumOptionalNumber(stages, (stage) => stage.inputTokens) }
      : {}),
    ...(sumOptionalNumber(stages, (stage) => stage.outputTokens) !== undefined
      ? { outputTokens: sumOptionalNumber(stages, (stage) => stage.outputTokens) }
      : {}),
    ...(sumOptionalNumber(stages, (stage) => stage.totalCostUsd) !== undefined
      ? {
          totalCostUsd: sumOptionalNumber(
            stages,
            (stage) => stage.totalCostUsd,
          ),
        }
      : {}),
    ...(args.scenario.spec.stageMode === "single" && finalStage.subtype !== undefined
      ? { subtype: finalStage.subtype }
      : {}),
    ...(args.scenario.spec.stageMode === "single" &&
    finalStage.sessionId !== undefined
      ? { sessionId: finalStage.sessionId }
      : {}),
  };
}

function writeHarnessArtifact(args: {
  artifact: HarnessParityArtifact;
  scenario: LoadedScenario;
  workingDir: string;
  stageRecords: readonly HarnessParityStageRunRecord[];
}): void {
  const { artifact, scenario, stageRecords } = args;
  const finalStage = stageRecords[stageRecords.length - 1]!;
  const firstRunError =
    stageRecords.find((stage) => stage.runError !== null)?.runError ?? null;
  if (scenario.spec.stageMode === "staged") {
    writeFileSync(
      join(artifact.artifactDir, "prompt.txt"),
      buildStagedPromptText(scenario.spec.stages),
    );
    writeFileSync(join(artifact.artifactDir, "diff.patch"), finalStage.diff);
    writeFileSync(
      join(artifact.artifactDir, "verification.json"),
      JSON.stringify(artifact.verification, null, 2),
    );
    writeFileSync(
      join(artifact.artifactDir, "trace.txt"),
      tail(
        stageRecords
          .map((stage) => `## ${stage.stageId}\n${stage.streamedText}`)
          .join("\n\n"),
        TRACE_TAIL_LIMIT,
      ),
    );
    writeStagedTrajectoryArtifacts(artifact);
  }

  writeFileSync(
    join(artifact.artifactDir, "run-meta.json"),
    JSON.stringify(
      {
        ...artifact,
        workingDir: args.workingDir,
        error: firstRunError
          ? { message: firstRunError.message, stack: firstRunError.stack }
          : null,
        stages: stageRecords.map(
          ({ diff: _diff, runError, streamedText: _streamedText, ...stage }) => ({
            ...stage,
            error: runError
              ? { message: runError.message, stack: runError.stack }
              : null,
          }),
        ),
      },
      null,
      2,
    ),
  );

  if (scenario.spec.stageMode === "staged") {
    writeFileSync(
      join(artifact.artifactDir, "trace-summary.md"),
      buildStagedTraceSummary(artifact),
    );
  }
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
  const runStartedAt = new Date();
  const runStartMs = runStartedAt.getTime();
  const effort: AgentEffort = DEFAULT_EFFORT;

  const stageRecords: HarnessParityStageRunRecord[] = [];
  try {
    for (const stage of scenario.spec.stages) {
      const stageDir =
        scenario.spec.stageMode === "single"
          ? artifactDir
          : join(artifactDir, "stages", stage.id);
      stageRecords.push(
        await runScenarioStageOnHarness({
          scenario,
          stage,
          harness,
          callOptions,
          artifactDir: stageDir,
          capability,
          workingDir,
          effort,
        }),
      );
    }

    const artifact = buildHarnessArtifact({
      scenario,
      harness,
      callOptions,
      artifactDir,
      workingDir,
      capability,
      stageRecords,
      startedAt: runStartedAt,
      durationMs: Date.now() - runStartMs,
    });
    writeHarnessArtifact({
      artifact,
      scenario,
      workingDir,
      stageRecords,
    });

    return artifact;
  } finally {
    if (!params.keepWorkingDir) {
      rmSync(workingDir, { recursive: true, force: true });
    }
  }
}

function buildTraceSummary(
  artifact: HarnessParityArtifact | HarnessParityStageArtifact,
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
  lines.push(
    `- trajectoryDiagnostics: warnings=${artifact.trajectoryDiagnostics.warningCount}, artifact=${artifact.trajectoryDiagnostics.artifactPath}`,
  );
  lines.push(`- changedFiles (${artifact.changedFiles.length}):`);
  for (const path of artifact.changedFiles) lines.push(`  - ${path}`);
  if (artifact.previewArtifacts.length > 0) {
    lines.push(`- previewArtifacts (${artifact.previewArtifacts.length}):`);
    for (const preview of artifact.previewArtifacts) {
      if (preview.preserved) {
        lines.push(`  - ${preview.sourcePath}: ${preview.artifactPath}`);
      } else {
        lines.push(
          `  - ${preview.sourcePath}: ${preview.reason} (${preview.artifactPath})`,
        );
      }
    }
  }
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
        stageMode: params.scenario.spec.stageMode,
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
          trajectoryDiagnostics: a.trajectoryDiagnostics,
          stagedSummary: a.stagedSummary,
          previewArtifacts: a.previewArtifacts,
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
