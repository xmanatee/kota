import type {
  HarnessCapabilitySnapshot,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";

export const TRAJECTORY_DIAGNOSTICS_ARTIFACT_NAME =
  "trajectory-diagnostics.json";

const PRE_IMPLEMENTATION_TOOL_CALL_WARNING_THRESHOLD = 6;

export type HarnessParityTrajectoryDiagnosticCode =
  | "unsupported_trajectory"
  | "missing_streaming_frames"
  | "missing_final_verification_after_edit"
  | "repeated_identical_failing_command"
  | "edit_after_successful_verification"
  | "long_preamble_without_task_touch";

export type HarnessParityTrajectoryDiagnosticsCounts = {
  warningCount: number;
  unsupportedTrajectoryCount: number;
  missingStreamingFramesCount: number;
  missingFinalVerificationAfterEditCount: number;
  repeatedIdenticalFailingCommandCount: number;
  editAfterSuccessfulVerificationCount: number;
  longPreambleWithoutTaskTouchCount: number;
};

export type HarnessParityTrajectoryDiagnostic = {
  code: HarnessParityTrajectoryDiagnosticCode;
  severity: "warning";
  summary: string;
  frameIndexes: readonly number[];
  details: readonly string[];
};

export type HarnessParityTrajectoryDiagnosticsArtifact = {
  version: 1;
  status: "supported" | "unsupported";
  emitsAgentMessageStream: boolean;
  counts: HarnessParityTrajectoryDiagnosticsCounts;
  diagnostics: readonly HarnessParityTrajectoryDiagnostic[];
};

export type HarnessParityTrajectoryDiagnosticsMetadata =
  HarnessParityTrajectoryDiagnosticsCounts & {
    artifactPath: string;
  };

type TrajectoryToolCall = {
  index: number;
  message: Extract<KotaAgentMessage, { type: "tool_call" }>;
  command: string | null;
  isFileEdit: boolean;
  isVerification: boolean;
  touchesRelevantFile: boolean;
};

type CompletedTrajectoryToolCall = TrajectoryToolCall & {
  resultIndex: number;
  resultIsError: boolean;
};

export function buildTrajectoryDiagnosticsArtifact(args: {
  capability: Pick<HarnessCapabilitySnapshot, "emitsAgentMessageStream">;
  messages: readonly KotaAgentMessage[];
  changedFiles: readonly string[];
  verificationCommand: string;
}): HarnessParityTrajectoryDiagnosticsArtifact {
  const diagnostics: HarnessParityTrajectoryDiagnostic[] = [];
  if (!args.capability.emitsAgentMessageStream) {
    diagnostics.push({
      code: "unsupported_trajectory",
      severity: "warning",
      summary:
        "Harness does not emit KOTA-native message frames, so trajectory-quality checks are unsupported.",
      frameIndexes: [],
      details: [
        "capability.emitsAgentMessageStream=false",
        `scenarioVerification=${args.verificationCommand}`,
      ],
    });
    return buildDiagnosticsArtifact("unsupported", false, diagnostics);
  }

  if (args.messages.length === 0) {
    diagnostics.push({
      code: "missing_streaming_frames",
      severity: "warning",
      summary:
        "Harness declares KOTA-native message streaming but emitted no trajectory frames.",
      frameIndexes: [],
      details: [
        "capability.emitsAgentMessageStream=true",
        `scenarioVerification=${args.verificationCommand}`,
      ],
    });
    return buildDiagnosticsArtifact("supported", true, diagnostics);
  }

  const toolCalls = collectToolCalls(
    args.messages,
    args.changedFiles,
    args.verificationCommand,
  );
  const completedToolCalls = collectCompletedToolCalls(args.messages, toolCalls);
  diagnostics.push(...diagnoseVerificationAfterEdits(toolCalls, completedToolCalls));
  diagnostics.push(...diagnoseRepeatedFailingCommands(completedToolCalls));
  diagnostics.push(...diagnoseLongPreamble(toolCalls, args.changedFiles));

  return buildDiagnosticsArtifact("supported", true, diagnostics);
}

export function trajectoryDiagnosticsMetadata(
  artifact: HarnessParityTrajectoryDiagnosticsArtifact,
  artifactPath: string,
): HarnessParityTrajectoryDiagnosticsMetadata {
  return {
    artifactPath,
    ...artifact.counts,
  };
}

export function aggregateTrajectoryDiagnosticsMetadata(
  stages: readonly HarnessParityTrajectoryDiagnosticsMetadata[],
  artifactPath: string,
): HarnessParityTrajectoryDiagnosticsMetadata {
  return {
    artifactPath,
    warningCount: stages.reduce((sum, stage) => sum + stage.warningCount, 0),
    unsupportedTrajectoryCount: stages.reduce(
      (sum, stage) => sum + stage.unsupportedTrajectoryCount,
      0,
    ),
    missingStreamingFramesCount: stages.reduce(
      (sum, stage) => sum + stage.missingStreamingFramesCount,
      0,
    ),
    missingFinalVerificationAfterEditCount: stages.reduce(
      (sum, stage) => sum + stage.missingFinalVerificationAfterEditCount,
      0,
    ),
    repeatedIdenticalFailingCommandCount: stages.reduce(
      (sum, stage) => sum + stage.repeatedIdenticalFailingCommandCount,
      0,
    ),
    editAfterSuccessfulVerificationCount: stages.reduce(
      (sum, stage) => sum + stage.editAfterSuccessfulVerificationCount,
      0,
    ),
    longPreambleWithoutTaskTouchCount: stages.reduce(
      (sum, stage) => sum + stage.longPreambleWithoutTaskTouchCount,
      0,
    ),
  };
}

function buildDiagnosticsArtifact(
  status: "supported" | "unsupported",
  emitsAgentMessageStream: boolean,
  diagnostics: readonly HarnessParityTrajectoryDiagnostic[],
): HarnessParityTrajectoryDiagnosticsArtifact {
  return {
    version: 1,
    status,
    emitsAgentMessageStream,
    counts: countDiagnostics(diagnostics),
    diagnostics: [...diagnostics],
  };
}

function emptyDiagnosticCounts(): HarnessParityTrajectoryDiagnosticsCounts {
  return {
    warningCount: 0,
    unsupportedTrajectoryCount: 0,
    missingStreamingFramesCount: 0,
    missingFinalVerificationAfterEditCount: 0,
    repeatedIdenticalFailingCommandCount: 0,
    editAfterSuccessfulVerificationCount: 0,
    longPreambleWithoutTaskTouchCount: 0,
  };
}

function countDiagnostics(
  diagnostics: readonly HarnessParityTrajectoryDiagnostic[],
): HarnessParityTrajectoryDiagnosticsCounts {
  const counts = emptyDiagnosticCounts();
  counts.warningCount = diagnostics.length;
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === "unsupported_trajectory") {
      counts.unsupportedTrajectoryCount += 1;
    } else if (diagnostic.code === "missing_streaming_frames") {
      counts.missingStreamingFramesCount += 1;
    } else if (diagnostic.code === "missing_final_verification_after_edit") {
      counts.missingFinalVerificationAfterEditCount += 1;
    } else if (diagnostic.code === "repeated_identical_failing_command") {
      counts.repeatedIdenticalFailingCommandCount += 1;
    } else if (diagnostic.code === "edit_after_successful_verification") {
      counts.editAfterSuccessfulVerificationCount += 1;
    } else {
      counts.longPreambleWithoutTaskTouchCount += 1;
    }
  }
  return counts;
}

function collectToolCalls(
  messages: readonly KotaAgentMessage[],
  changedFiles: readonly string[],
  verificationCommand: string,
): TrajectoryToolCall[] {
  const calls: TrajectoryToolCall[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.type !== "tool_call") continue;
    const command = extractCommand(message);
    calls.push({
      index,
      message,
      command,
      isFileEdit: isFileEditingToolCall(message, command),
      isVerification:
        command !== null &&
        isVerificationLikeCommand(command, verificationCommand),
      touchesRelevantFile: touchesRelevantFile(message, changedFiles),
    });
  }
  return calls;
}

function collectCompletedToolCalls(
  messages: readonly KotaAgentMessage[],
  toolCalls: readonly TrajectoryToolCall[],
): CompletedTrajectoryToolCall[] {
  const callsByUseId = new Map<string, TrajectoryToolCall>();
  for (const call of toolCalls) callsByUseId.set(call.message.toolUseId, call);

  const completed: CompletedTrajectoryToolCall[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.type !== "tool_result") continue;
    const call = callsByUseId.get(message.toolUseId);
    if (call === undefined) continue;
    completed.push({
      ...call,
      resultIndex: index,
      resultIsError: message.isError,
    });
  }
  return completed.sort((left, right) => left.index - right.index);
}

function diagnoseVerificationAfterEdits(
  toolCalls: readonly TrajectoryToolCall[],
  completedToolCalls: readonly CompletedTrajectoryToolCall[],
): HarnessParityTrajectoryDiagnostic[] {
  const diagnostics: HarnessParityTrajectoryDiagnostic[] = [];
  const editCalls = toolCalls.filter((call) => call.isFileEdit);
  if (editCalls.length === 0) return diagnostics;

  const verificationCalls = toolCalls.filter((call) => call.isVerification);
  const lastEdit = editCalls[editCalls.length - 1]!;
  const hasVerificationAfterLastEdit = verificationCalls.some(
    (call) => call.index > lastEdit.index,
  );
  if (!hasVerificationAfterLastEdit) {
    diagnostics.push({
      code: "missing_final_verification_after_edit",
      severity: "warning",
      summary:
        "A file-editing action was not followed by a verification-like command before the run ended.",
      frameIndexes: [lastEdit.index],
      details: [
        `lastEditFrame=${lastEdit.index}`,
        `lastEditTool=${lastEdit.message.toolName}`,
      ],
    });
  }

  const successfulVerifications = completedToolCalls.filter(
    (call) => call.isVerification && !call.resultIsError,
  );
  for (const verification of successfulVerifications) {
    const editAfterVerification = editCalls.find(
      (call) => call.index > verification.resultIndex,
    );
    if (editAfterVerification === undefined) continue;
    const hasLaterVerification = verificationCalls.some(
      (call) => call.index > editAfterVerification.index,
    );
    if (hasLaterVerification) continue;
    diagnostics.push({
      code: "edit_after_successful_verification",
      severity: "warning",
      summary:
        "A successful verification-like command was followed by further file edits without another verification.",
      frameIndexes: [
        verification.index,
        verification.resultIndex,
        editAfterVerification.index,
      ],
      details: [
        `verificationCommand=${verification.command ?? ""}`,
        `editFrame=${editAfterVerification.index}`,
      ],
    });
    break;
  }

  return diagnostics;
}

function diagnoseRepeatedFailingCommands(
  completedToolCalls: readonly CompletedTrajectoryToolCall[],
): HarnessParityTrajectoryDiagnostic[] {
  const diagnostics: HarnessParityTrajectoryDiagnostic[] = [];
  const edits = completedToolCalls.filter((call) => call.isFileEdit);
  const previousFailureByCommand = new Map<string, CompletedTrajectoryToolCall>();

  for (const call of completedToolCalls) {
    if (call.command === null || !call.resultIsError) continue;
    const signature = `${call.message.toolName}:${call.command}`;
    const previous = previousFailureByCommand.get(signature);
    if (
      previous !== undefined &&
      !edits.some(
        (edit) =>
          edit.index > previous.resultIndex && edit.index < call.index,
      )
    ) {
      diagnostics.push({
        code: "repeated_identical_failing_command",
        severity: "warning",
        summary:
          "The same failing command was retried without an intervening code or config edit.",
        frameIndexes: [
          previous.index,
          previous.resultIndex,
          call.index,
          call.resultIndex,
        ],
        details: [`command=${call.command}`],
      });
      break;
    }
    previousFailureByCommand.set(signature, call);
  }

  return diagnostics;
}

function diagnoseLongPreamble(
  toolCalls: readonly TrajectoryToolCall[],
  changedFiles: readonly string[],
): HarnessParityTrajectoryDiagnostic[] {
  if (changedFiles.length === 0) return [];
  const firstEdit = toolCalls.find((call) => call.isFileEdit);
  if (firstEdit === undefined) return [];
  const preImplementationCalls = toolCalls.filter(
    (call) => call.index < firstEdit.index,
  );
  if (
    preImplementationCalls.length < PRE_IMPLEMENTATION_TOOL_CALL_WARNING_THRESHOLD
  ) {
    return [];
  }
  if (preImplementationCalls.some((call) => call.touchesRelevantFile)) return [];

  return [
    {
      code: "long_preamble_without_task_touch",
      severity: "warning",
      summary:
        "A long pre-implementation tool sequence did not touch any changed task-relevant files before the first edit.",
      frameIndexes: preImplementationCalls.map((call) => call.index),
      details: [
        `preImplementationToolCalls=${preImplementationCalls.length}`,
        `changedFiles=${changedFiles.join(",")}`,
      ],
    },
  ];
}

function extractCommand(
  message: Extract<KotaAgentMessage, { type: "tool_call" }>,
): string | null {
  if (!isCommandToolName(message.toolName)) return null;
  for (const key of ["command", "cmd", "script"]) {
    const value = message.input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return normalizeCommand(value);
    }
  }

  const stringValues = Object.values(message.input).filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );
  if (stringValues.length !== 1) return null;
  return normalizeCommand(stringValues[0]!);
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function isCommandToolName(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return (
    normalized.includes("bash") ||
    normalized.includes("shell") ||
    normalized.includes("exec") ||
    normalized.includes("command") ||
    normalized.includes("terminal") ||
    normalized.includes("run")
  );
}

function isFileEditingToolCall(
  message: Extract<KotaAgentMessage, { type: "tool_call" }>,
  command: string | null,
): boolean {
  const toolName = message.toolName.toLowerCase();
  if (
    toolName.includes("edit") ||
    toolName.includes("write") ||
    toolName.includes("patch") ||
    toolName.includes("replace")
  ) {
    return true;
  }
  return command !== null && looksLikeMutatingCommand(command);
}

function looksLikeMutatingCommand(command: string): boolean {
  return /(^|\s)(apply_patch|git apply|sed\s+-i|perl\s+-pi|tee\s+|mv\s+|cp\s+)/.test(
    command,
  ) || /\s(>|>>)\s*\S+/.test(command);
}

function isVerificationLikeCommand(
  command: string,
  verificationCommand: string,
): boolean {
  if (command === normalizeCommand(verificationCommand)) return true;
  return (
    /\b(pnpm|npm|yarn|bun)\s+([^&|;]*\s)?(test|vitest|jest|lint|typecheck|check)\b/i.test(
      command,
    ) ||
    /\b(vitest|jest|mocha|pytest|ruff|mypy|tsc|eslint|biome|playwright)\b/i.test(
      command,
    ) ||
    /\b(cargo|go|deno)\s+test\b/i.test(command) ||
    /\b(make|just)\s+([^&|;]*\s)?(test|verify|check)\b/i.test(command) ||
    /\bnode\s+\S*(test|verify|check)\S*/i.test(command)
  );
}

function touchesRelevantFile(
  message: Extract<KotaAgentMessage, { type: "tool_call" }>,
  changedFiles: readonly string[],
): boolean {
  if (changedFiles.length === 0) return false;
  const serializedInput = JSON.stringify(message.input).toLowerCase();
  return changedFiles.some((file) => {
    const normalizedFile = file.toLowerCase();
    return (
      normalizedFile.length > 0 &&
      (serializedInput.includes(normalizedFile) ||
        serializedInput.includes(normalizedFile.split("/").at(-1) ?? ""))
    );
  });
}
