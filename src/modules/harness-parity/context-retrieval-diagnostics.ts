import type {
  HarnessCapabilitySnapshot,
  KotaAgentMessage,
  KotaContentBlock,
  KotaToolResultBlock,
} from "#core/agent-harness/index.js";
import type {
  ScenarioContextRetrievalSpec,
  ScenarioContextRetrievalTarget,
} from "./scenario.js";

export const CONTEXT_RETRIEVAL_DIAGNOSTICS_ARTIFACT_NAME =
  "context-retrieval-diagnostics.json";

const MAX_SCAN_TEXT_LENGTH = 200_000;
const MAX_OBSERVED_RETRIEVAL_ACTIONS = 50;

export type ContextRetrievalActionCategory =
  | "search"
  | "repo_map"
  | "find_reference"
  | "go_to_definition"
  | "read_file"
  | "remote_code_lookup";

export type ContextRetrievalMatchClass = "path" | "glob";

export type ContextRetrievalMatchSource =
  | "input"
  | "result"
  | "input_and_result"
  | "none";

export type ContextRetrievalWarningCode =
  | "unsupported_trajectory"
  | "missing_streaming_frames"
  | "unsupported_trajectory_frames"
  | "missed_retrieval_target"
  | "relevant_retrieval_after_first_edit"
  | "noisy_irrelevant_reads";

export type ContextRetrievalWarning = {
  code: ContextRetrievalWarningCode;
  severity: "warning";
  summary: string;
  frameIndexes: readonly number[];
  details: readonly string[];
};

export type ContextRetrievalUnsupportedTrajectoryState =
  | {
      kind: "none";
      rawFrameCount: number;
    }
  | {
      kind: "harness_does_not_emit_messages";
      reason: string;
      rawFrameCount: 0;
    }
  | {
      kind: "missing_streaming_frames";
      reason: string;
      rawFrameCount: 0;
    }
  | {
      kind: "raw_frames_present";
      reason: string;
      rawFrameCount: number;
    };

export type ContextRetrievalExpectedTargetReport = {
  id: string;
  kind: ScenarioContextRetrievalTarget["kind"];
  patterns: readonly string[];
  reached: boolean;
  firstReachedFrame: number | null;
  reachedBeforeFirstEdit: boolean;
  matchClass: ContextRetrievalMatchClass | null;
};

export type ContextRetrievalObservedAction = {
  frameIndex: number;
  toolName: string;
  category: ContextRetrievalActionCategory;
  matchedTargetIds: readonly string[];
  matchClass: ContextRetrievalMatchClass | "none";
  matchSource: ContextRetrievalMatchSource;
  beforeFirstEdit: boolean;
};

export type ContextRetrievalDiagnosticsCounts = {
  expectedTargetCount: number;
  reachedTargetCount: number;
  missedTargetCount: number;
  retrievalActionCount: number;
  relevantRetrievalActionCount: number;
  preEditRelevantRetrievalActionCount: number;
  lateRelevantRetrievalActionCount: number;
  noisyIrrelevantReadCount: number;
  unsupportedTrajectoryFrameCount: number;
  warningCount: number;
};

export type ContextRetrievalDiagnosticsArtifact = {
  version: 1;
  status: "supported" | "unsupported";
  emitsAgentMessageStream: boolean;
  expectedTargets: readonly ContextRetrievalExpectedTargetReport[];
  observedRetrievalActions: readonly ContextRetrievalObservedAction[];
  truncatedObservedRetrievalActionCount: number;
  firstImplementationEditFrame: number | null;
  firstRelevantRetrievalFrame: number | null;
  relevantRetrievalBeforeFirstEdit: boolean;
  missedTargets: readonly string[];
  noisyIrrelevantReadCount: number;
  unsupportedTrajectoryState: ContextRetrievalUnsupportedTrajectoryState;
  counts: ContextRetrievalDiagnosticsCounts;
  warnings: readonly ContextRetrievalWarning[];
};

export type ContextRetrievalDiagnosticsMetadata =
  ContextRetrievalDiagnosticsCounts & {
    artifactPath: string;
    status: "supported" | "unsupported";
    firstRelevantRetrievalFrame: number | null;
    relevantRetrievalBeforeFirstEdit: boolean;
    missedTargets: readonly string[];
    unsupportedTrajectoryState: ContextRetrievalUnsupportedTrajectoryState["kind"];
  };

type ToolCallMessage = Extract<KotaAgentMessage, { type: "tool_call" }>;
type ToolResultMessage = Extract<KotaAgentMessage, { type: "tool_result" }>;
type ToolResultRichContentBlock = Exclude<
  KotaToolResultBlock["content"],
  string
>[number];
type McpPreservedContent = Extract<
  ToolResultRichContentBlock,
  { type: "mcp_content" }
>["content"];

type TargetMatch = {
  targetId: string;
  matchClass: ContextRetrievalMatchClass;
  source: Exclude<ContextRetrievalMatchSource, "none">;
};

type ObservedRetrievalActionRecord = ContextRetrievalObservedAction & {
  allMatchedTargetIds: readonly string[];
};

type TargetReach = {
  firstReachedFrame: number;
  reachedBeforeFirstEdit: boolean;
  matchClass: ContextRetrievalMatchClass;
};

export function buildContextRetrievalDiagnosticsArtifact(args: {
  capability: Pick<HarnessCapabilitySnapshot, "emitsAgentMessageStream">;
  messages: readonly KotaAgentMessage[];
  expectation: ScenarioContextRetrievalSpec;
}): ContextRetrievalDiagnosticsArtifact {
  if (!args.capability.emitsAgentMessageStream) {
    return buildUnsupportedArtifact({
      expectation: args.expectation,
      emitsAgentMessageStream: false,
      unsupportedTrajectoryState: {
        kind: "harness_does_not_emit_messages",
        reason:
          "Harness capability snapshot declares emitsAgentMessageStream=false.",
        rawFrameCount: 0,
      },
      warning: {
        code: "unsupported_trajectory",
        severity: "warning",
        summary:
          "Harness does not emit KOTA-native message frames, so context-retrieval diagnostics are unsupported.",
        frameIndexes: [],
        details: ["capability.emitsAgentMessageStream=false"],
      },
    });
  }

  if (args.messages.length === 0) {
    return buildUnsupportedArtifact({
      expectation: args.expectation,
      emitsAgentMessageStream: true,
      unsupportedTrajectoryState: {
        kind: "missing_streaming_frames",
        reason:
          "Harness declares KOTA-native message streaming but emitted no trajectory frames.",
        rawFrameCount: 0,
      },
      warning: {
        code: "missing_streaming_frames",
        severity: "warning",
        summary:
          "Harness declares KOTA-native message streaming but emitted no frames to inspect.",
        frameIndexes: [],
        details: ["capability.emitsAgentMessageStream=true"],
      },
    });
  }

  const firstImplementationEditFrame = firstFileEditFrame(args.messages);
  const rawFrameIndexes = args.messages
    .map((message, index) => (message.type === "raw" ? index : null))
    .filter((index): index is number => index !== null);
  const toolResultsByUseId = collectToolResults(args.messages);
  const observed = collectRetrievalActions({
    messages: args.messages,
    expectation: args.expectation,
    firstImplementationEditFrame,
    toolResultsByUseId,
  });
  const targetReaches = collectTargetReaches(
    args.expectation,
    observed,
    firstImplementationEditFrame,
  );
  const expectedTargets = args.expectation.targets.map((target) =>
    buildExpectedTargetReport(target, targetReaches.get(target.id)),
  );
  const missedTargets = expectedTargets
    .filter((target) => !target.reached)
    .map((target) => target.id);
  const firstRelevantRetrievalFrame = firstRelevantRetrieval(observed);
  const noisyIrrelevantReadCount = observed.filter(
    (action) =>
      action.category === "read_file" && action.allMatchedTargetIds.length === 0,
  ).length;
  const unsupportedTrajectoryState =
    rawFrameIndexes.length > 0
      ? {
          kind: "raw_frames_present" as const,
          reason:
            "One or more adapter-specific raw frames could not be classified.",
          rawFrameCount: rawFrameIndexes.length,
        }
      : {
          kind: "none" as const,
          rawFrameCount: 0,
        };
  const warnings = buildSupportedWarnings({
    missedTargets,
    expectedTargets,
    observed,
    firstImplementationEditFrame,
    noisyIrrelevantReadCount,
    rawFrameIndexes,
  });
  const counts = countDiagnostics({
    expectedTargets,
    observed,
    missedTargets,
    noisyIrrelevantReadCount,
    rawFrameCount: rawFrameIndexes.length,
    warnings,
  });

  return {
    version: 1,
    status: "supported",
    emitsAgentMessageStream: true,
    expectedTargets,
    observedRetrievalActions: observed.slice(0, MAX_OBSERVED_RETRIEVAL_ACTIONS),
    truncatedObservedRetrievalActionCount: Math.max(
      0,
      observed.length - MAX_OBSERVED_RETRIEVAL_ACTIONS,
    ),
    firstImplementationEditFrame,
    firstRelevantRetrievalFrame,
    relevantRetrievalBeforeFirstEdit:
      firstRelevantRetrievalFrame !== null &&
      (firstImplementationEditFrame === null ||
        firstRelevantRetrievalFrame < firstImplementationEditFrame),
    missedTargets,
    noisyIrrelevantReadCount,
    unsupportedTrajectoryState,
    counts,
    warnings,
  };
}

export function contextRetrievalDiagnosticsMetadata(
  artifact: ContextRetrievalDiagnosticsArtifact,
  artifactPath: string,
): ContextRetrievalDiagnosticsMetadata {
  return {
    artifactPath,
    status: artifact.status,
    firstRelevantRetrievalFrame: artifact.firstRelevantRetrievalFrame,
    relevantRetrievalBeforeFirstEdit: artifact.relevantRetrievalBeforeFirstEdit,
    missedTargets: artifact.missedTargets,
    unsupportedTrajectoryState: artifact.unsupportedTrajectoryState.kind,
    ...artifact.counts,
  };
}

export function aggregateContextRetrievalDiagnosticsMetadata(
  stages: readonly ContextRetrievalDiagnosticsMetadata[],
  artifactPath: string,
): ContextRetrievalDiagnosticsMetadata | undefined {
  if (stages.length === 0) return undefined;
  const firstRelevantFrames = stages
    .map((stage) => stage.firstRelevantRetrievalFrame)
    .filter((frame): frame is number => frame !== null);
  const status = stages.every((stage) => stage.status === "unsupported")
    ? "unsupported"
    : "supported";
  const unsupportedTrajectoryState = stages.find(
    (stage) => stage.unsupportedTrajectoryState !== "none",
  )?.unsupportedTrajectoryState ?? "none";
  return {
    artifactPath,
    status,
    firstRelevantRetrievalFrame:
      firstRelevantFrames.length === 0 ? null : Math.min(...firstRelevantFrames),
    relevantRetrievalBeforeFirstEdit: stages.some(
      (stage) => stage.relevantRetrievalBeforeFirstEdit,
    ),
    missedTargets: stages.flatMap((stage) => stage.missedTargets),
    unsupportedTrajectoryState,
    expectedTargetCount: sum(stages, "expectedTargetCount"),
    reachedTargetCount: sum(stages, "reachedTargetCount"),
    missedTargetCount: sum(stages, "missedTargetCount"),
    retrievalActionCount: sum(stages, "retrievalActionCount"),
    relevantRetrievalActionCount: sum(stages, "relevantRetrievalActionCount"),
    preEditRelevantRetrievalActionCount: sum(
      stages,
      "preEditRelevantRetrievalActionCount",
    ),
    lateRelevantRetrievalActionCount: sum(
      stages,
      "lateRelevantRetrievalActionCount",
    ),
    noisyIrrelevantReadCount: sum(stages, "noisyIrrelevantReadCount"),
    unsupportedTrajectoryFrameCount: sum(
      stages,
      "unsupportedTrajectoryFrameCount",
    ),
    warningCount: sum(stages, "warningCount"),
  };
}

function buildUnsupportedArtifact(args: {
  expectation: ScenarioContextRetrievalSpec;
  emitsAgentMessageStream: boolean;
  unsupportedTrajectoryState: ContextRetrievalUnsupportedTrajectoryState;
  warning: ContextRetrievalWarning;
}): ContextRetrievalDiagnosticsArtifact {
  const expectedTargets = args.expectation.targets.map((target) =>
    buildExpectedTargetReport(target, undefined),
  );
  const missedTargets = expectedTargets.map((target) => target.id);
  const counts = countDiagnostics({
    expectedTargets,
    observed: [],
    missedTargets,
    noisyIrrelevantReadCount: 0,
    rawFrameCount: 0,
    warnings: [args.warning],
  });
  return {
    version: 1,
    status: "unsupported",
    emitsAgentMessageStream: args.emitsAgentMessageStream,
    expectedTargets,
    observedRetrievalActions: [],
    truncatedObservedRetrievalActionCount: 0,
    firstImplementationEditFrame: null,
    firstRelevantRetrievalFrame: null,
    relevantRetrievalBeforeFirstEdit: false,
    missedTargets,
    noisyIrrelevantReadCount: 0,
    unsupportedTrajectoryState: args.unsupportedTrajectoryState,
    counts,
    warnings: [args.warning],
  };
}

function collectToolResults(
  messages: readonly KotaAgentMessage[],
): Map<string, ToolResultMessage> {
  const results = new Map<string, ToolResultMessage>();
  for (const message of messages) {
    if (message.type !== "tool_result" || results.has(message.toolUseId)) {
      continue;
    }
    results.set(message.toolUseId, message);
  }
  return results;
}

function collectRetrievalActions(args: {
  messages: readonly KotaAgentMessage[];
  expectation: ScenarioContextRetrievalSpec;
  firstImplementationEditFrame: number | null;
  toolResultsByUseId: ReadonlyMap<string, ToolResultMessage>;
}): ObservedRetrievalActionRecord[] {
  const actions: ObservedRetrievalActionRecord[] = [];
  for (const [index, message] of args.messages.entries()) {
    if (message.type !== "tool_call") continue;
    const category = classifyContextRetrievalAction(message);
    if (category === null) continue;
    const inputText = boundedStringify(message.input);
    const result = args.toolResultsByUseId.get(message.toolUseId);
    const resultText = result === undefined ? "" : toolResultText(result);
    const matches = matchTargets(args.expectation.targets, inputText, resultText);
    const matchedTargetIds = unique(matches.map((match) => match.targetId));
    actions.push({
      frameIndex: index,
      toolName: message.toolName,
      category,
      matchedTargetIds,
      allMatchedTargetIds: matchedTargetIds,
      matchClass: matchClass(matches),
      matchSource: matchSource(matches),
      beforeFirstEdit:
        args.firstImplementationEditFrame === null ||
        index < args.firstImplementationEditFrame,
    });
  }
  return actions;
}

function collectTargetReaches(
  expectation: ScenarioContextRetrievalSpec,
  observed: readonly ObservedRetrievalActionRecord[],
  firstImplementationEditFrame: number | null,
): Map<string, TargetReach> {
  const reaches = new Map<string, TargetReach>();
  for (const target of expectation.targets) {
    const firstAction = observed.find((action) =>
      action.allMatchedTargetIds.includes(target.id),
    );
    if (firstAction === undefined) continue;
    reaches.set(target.id, {
      firstReachedFrame: firstAction.frameIndex,
      reachedBeforeFirstEdit:
        firstImplementationEditFrame === null ||
        firstAction.frameIndex < firstImplementationEditFrame,
      matchClass:
        firstAction.matchClass === "none" ? targetDefaultMatchClass(target) : firstAction.matchClass,
    });
  }
  return reaches;
}

function buildExpectedTargetReport(
  target: ScenarioContextRetrievalTarget,
  reach: TargetReach | undefined,
): ContextRetrievalExpectedTargetReport {
  return {
    id: target.id,
    kind: target.kind,
    patterns: targetPatterns(target),
    reached: reach !== undefined,
    firstReachedFrame: reach?.firstReachedFrame ?? null,
    reachedBeforeFirstEdit: reach?.reachedBeforeFirstEdit ?? false,
    matchClass: reach?.matchClass ?? null,
  };
}

function buildSupportedWarnings(args: {
  missedTargets: readonly string[];
  expectedTargets: readonly ContextRetrievalExpectedTargetReport[];
  observed: readonly ObservedRetrievalActionRecord[];
  firstImplementationEditFrame: number | null;
  noisyIrrelevantReadCount: number;
  rawFrameIndexes: readonly number[];
}): ContextRetrievalWarning[] {
  const warnings: ContextRetrievalWarning[] = [];
  if (args.rawFrameIndexes.length > 0) {
    warnings.push({
      code: "unsupported_trajectory_frames",
      severity: "warning",
      summary:
        "One or more adapter-specific raw trajectory frames could not be classified for context retrieval.",
      frameIndexes: args.rawFrameIndexes,
      details: [`rawFrameCount=${args.rawFrameIndexes.length}`],
    });
  }
  if (args.missedTargets.length > 0) {
    warnings.push({
      code: "missed_retrieval_target",
      severity: "warning",
      summary:
        "One or more expected context-retrieval targets were not observed in context-gathering actions.",
      frameIndexes: [],
      details: [`missedTargets=${args.missedTargets.join(",")}`],
    });
  }
  const lateTargets = args.expectedTargets.filter(
    (target) => target.reached && !target.reachedBeforeFirstEdit,
  );
  if (lateTargets.length > 0) {
    warnings.push({
      code: "relevant_retrieval_after_first_edit",
      severity: "warning",
      summary:
        "Relevant context was retrieved only after the first implementation edit.",
      frameIndexes: lateTargets
        .map((target) => target.firstReachedFrame)
        .filter((frame): frame is number => frame !== null),
      details: [`lateTargets=${lateTargets.map((target) => target.id).join(",")}`],
    });
  }
  if (args.noisyIrrelevantReadCount > 0) {
    warnings.push({
      code: "noisy_irrelevant_reads",
      severity: "warning",
      summary:
        "One or more read-file actions did not match any declared context target.",
      frameIndexes: args.observed
        .filter(
          (action) =>
            action.category === "read_file" &&
            action.allMatchedTargetIds.length === 0,
        )
        .map((action) => action.frameIndex),
      details: [`noisyIrrelevantReadCount=${args.noisyIrrelevantReadCount}`],
    });
  }
  return warnings;
}

function countDiagnostics(args: {
  expectedTargets: readonly ContextRetrievalExpectedTargetReport[];
  observed: readonly ObservedRetrievalActionRecord[];
  missedTargets: readonly string[];
  noisyIrrelevantReadCount: number;
  rawFrameCount: number;
  warnings: readonly ContextRetrievalWarning[];
}): ContextRetrievalDiagnosticsCounts {
  const relevantActions = args.observed.filter(
    (action) => action.allMatchedTargetIds.length > 0,
  );
  return {
    expectedTargetCount: args.expectedTargets.length,
    reachedTargetCount: args.expectedTargets.filter((target) => target.reached).length,
    missedTargetCount: args.missedTargets.length,
    retrievalActionCount: args.observed.length,
    relevantRetrievalActionCount: relevantActions.length,
    preEditRelevantRetrievalActionCount: relevantActions.filter(
      (action) => action.beforeFirstEdit,
    ).length,
    lateRelevantRetrievalActionCount: relevantActions.filter(
      (action) => !action.beforeFirstEdit,
    ).length,
    noisyIrrelevantReadCount: args.noisyIrrelevantReadCount,
    unsupportedTrajectoryFrameCount: args.rawFrameCount,
    warningCount: args.warnings.length,
  };
}

function firstRelevantRetrieval(
  observed: readonly ObservedRetrievalActionRecord[],
): number | null {
  const relevant = observed.find((action) => action.allMatchedTargetIds.length > 0);
  return relevant?.frameIndex ?? null;
}

function matchTargets(
  targets: readonly ScenarioContextRetrievalTarget[],
  inputText: string,
  resultText: string,
): TargetMatch[] {
  const matches: TargetMatch[] = [];
  for (const target of targets) {
    const inputMatchClass = targetMatchClass(target, inputText);
    const resultMatchClass = targetMatchClass(target, resultText);
    if (inputMatchClass !== null && resultMatchClass !== null) {
      matches.push({
        targetId: target.id,
        matchClass: inputMatchClass,
        source: "input_and_result",
      });
      continue;
    }
    if (inputMatchClass !== null) {
      matches.push({
        targetId: target.id,
        matchClass: inputMatchClass,
        source: "input",
      });
      continue;
    }
    if (resultMatchClass !== null) {
      matches.push({
        targetId: target.id,
        matchClass: resultMatchClass,
        source: "result",
      });
    }
  }
  return matches;
}

function targetMatchClass(
  target: ScenarioContextRetrievalTarget,
  text: string,
): ContextRetrievalMatchClass | null {
  if (text.length === 0) return null;
  if (target.kind === "path") {
    return text.includes(target.path) ? "path" : null;
  }
  if (target.kind === "path-group") {
    return target.paths.some((path) => text.includes(path)) ? "path" : null;
  }
  const candidates = pathCandidates(text);
  if (target.kind === "glob") {
    return matchesAnyGlob([target.glob], candidates) ? "glob" : null;
  }
  return matchesAnyGlob(target.globs, candidates) ? "glob" : null;
}

function targetPatterns(target: ScenarioContextRetrievalTarget): string[] {
  if (target.kind === "path") return [target.path];
  if (target.kind === "glob") return [target.glob];
  if (target.kind === "path-group") return [...target.paths];
  return [...target.globs];
}

function targetDefaultMatchClass(
  target: ScenarioContextRetrievalTarget,
): ContextRetrievalMatchClass {
  return target.kind === "path" || target.kind === "path-group" ? "path" : "glob";
}

function matchesAnyGlob(
  globs: readonly string[],
  candidates: readonly string[],
): boolean {
  const regexes = globs.map(globToRegExp);
  return candidates.some((candidate) => regexes.some((regex) => regex.test(candidate)));
}

function globToRegExp(glob: string): RegExp {
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function pathCandidates(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]+)+/g) ?? [];
  const candidates = new Set<string>();
  for (const match of matches) {
    const parts = match.split("/").filter((part) => part.length > 0);
    for (let index = 0; index < parts.length - 1; index += 1) {
      candidates.add(parts.slice(index).join("/"));
    }
  }
  return [...candidates];
}

function matchClass(
  matches: readonly TargetMatch[],
): ContextRetrievalMatchClass | "none" {
  if (matches.some((match) => match.matchClass === "path")) return "path";
  if (matches.some((match) => match.matchClass === "glob")) return "glob";
  return "none";
}

function matchSource(
  matches: readonly TargetMatch[],
): ContextRetrievalMatchSource {
  if (matches.length === 0) return "none";
  const hasInput = matches.some(
    (match) => match.source === "input" || match.source === "input_and_result",
  );
  const hasResult = matches.some(
    (match) => match.source === "result" || match.source === "input_and_result",
  );
  if (hasInput && hasResult) return "input_and_result";
  if (hasInput) return "input";
  return "result";
}

function classifyContextRetrievalAction(
  message: ToolCallMessage,
): ContextRetrievalActionCategory | null {
  const toolName = normalizedToolName(message.toolName);
  const command = extractCommand(message);
  const commandText = command?.toLowerCase() ?? "";
  const combined = `${toolName} ${commandText}`;
  if (
    combined.includes("sourcegraph") ||
    combined.includes("github") ||
    combined.includes("remote-code") ||
    combined.includes("remote_code") ||
    combined.includes("code-search")
  ) {
    return "remote_code_lookup";
  }
  if (
    combined.includes("find-reference") ||
    combined.includes("find_reference") ||
    combined.includes("references") ||
    combined.includes("usages")
  ) {
    return "find_reference";
  }
  if (
    combined.includes("go-to-definition") ||
    combined.includes("go_to_definition") ||
    combined.includes("definition")
  ) {
    return "go_to_definition";
  }
  if (
    toolName.includes("read") ||
    toolName.includes("view") ||
    toolName.includes("open") ||
    /(^|\s)(cat|sed\s+-n|head|tail|nl)\b/.test(commandText)
  ) {
    return "read_file";
  }
  if (
    toolName.includes("grep") ||
    toolName.includes("search") ||
    toolName.includes("glob") ||
    /(^|\s)(rg|grep|git\s+grep|fd|find)\b/.test(commandText)
  ) {
    return "search";
  }
  if (
    toolName.includes("repo-map") ||
    toolName.includes("repo_map") ||
    toolName.includes("tree") ||
    toolName.includes("list") ||
    toolName === "ls" ||
    /(^|\s)(ls|tree)\b/.test(commandText)
  ) {
    return "repo_map";
  }
  return null;
}

function normalizedToolName(toolName: string): string {
  return toolName.toLowerCase().replace(/[\s_]+/g, "-");
}

function firstFileEditFrame(messages: readonly KotaAgentMessage[]): number | null {
  for (const [index, message] of messages.entries()) {
    if (message.type !== "tool_call") continue;
    if (isFileEditingToolCall(message, extractCommand(message))) return index;
  }
  return null;
}

function isFileEditingToolCall(
  message: ToolCallMessage,
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
  return (
    /(^|\s)(apply_patch|git apply|sed\s+-i|perl\s+-pi|tee\s+|mv\s+|cp\s+)/.test(
      command,
    ) || /\s(>|>>)\s*\S+/.test(command)
  );
}

function extractCommand(message: ToolCallMessage): string | null {
  if (!isCommandToolName(message.toolName)) return null;
  for (const key of ["command", "cmd", "script"]) {
    const value = message.input[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return normalizeCommand(value);
    }
  }
  const serialized = boundedStringify(message.input);
  return serialized.length > 0 ? normalizeCommand(serialized) : null;
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

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function toolResultText(message: ToolResultMessage): string {
  if (typeof message.content === "string") return boundScanText(message.content);
  return boundScanText(message.content.map(contentBlockText).join("\n"));
}

function contentBlockText(block: KotaContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "tool_result") {
    return typeof block.content === "string"
      ? block.content
      : block.content.map(toolResultContentBlockText).join("\n");
  }
  return "";
}

function toolResultContentBlockText(
  block: ToolResultRichContentBlock,
): string {
  if (block.type === "text") return block.text;
  if (block.type === "mcp_content") return mcpContentText(block.content);
  return "";
}

function mcpContentText(content: McpPreservedContent): string {
  if (content.type === "resource") {
    if ("text" in content.resource) return content.resource.text;
    return content.resource.uri;
  }
  if (content.type === "resource_link") return content.uri;
  if (content.type === "unknown") return boundedStringify(content.raw);
  return "";
}

function boundedStringify(value: ToolCallMessage["input"]): string {
  try {
    return boundScanText(JSON.stringify(value));
  } catch {
    return "";
  }
}

function boundScanText(text: string): string {
  if (text.length <= MAX_SCAN_TEXT_LENGTH) return text;
  return text.slice(0, MAX_SCAN_TEXT_LENGTH);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function sum(
  stages: readonly ContextRetrievalDiagnosticsMetadata[],
  key: keyof ContextRetrievalDiagnosticsCounts,
): number {
  return stages.reduce((total, stage) => total + stage[key], 0);
}
