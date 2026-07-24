import { basename, dirname } from "node:path";
import {
  OBSERVABILITY_OBLIGATION_RATIONALE_ARTIFACT,
  type ObservabilityEvidence,
  type ObservabilitySensitivityReason,
  type ObservabilitySensitivityReasonKind,
} from "./observability-obligation-types.js";
import type { FileDiff } from "./staged-diff.js";

type ReasonRule = {
  kind: ObservabilitySensitivityReasonKind;
  message: string;
  matches: (file: string, changedText: string) => boolean;
};

const SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);

const EXCLUDED_PATH_PARTS = new Set([
  ".kota",
  ".next",
  "build",
  "coverage",
  "dist",
  "fixtures",
  "generated",
  "__generated__",
  "node_modules",
  "out",
  "vendor",
  "vendors",
  "third_party",
]);

const ERROR_HANDLING_RE =
  /\b(?:catch\s*(?:\(|\{)|throw\s+new|status\s*:\s*["'](?:failed|error|interrupted)["']|continueOnFailure|failedStep)\b/;
const RETRY_RECOVERY_RE =
  /\b(?:retry|backoff|recover(?:y|ed)?|timeout|abort|SIGTERM|SIGKILL|restart)\b/i;
const EXTERNAL_CALL_RE =
  /\b(?:fetch|request|httpRequest|execFile(?:Sync)?|execSync|spawn(?:Sync)?|send|post)\s*\(/;
const TOOL_EXECUTION_RE =
  /\b(?:runTool|executeTool|ToolDef|toolCalls?|canUseTool|toolPolicy|toolTelemetry)\b/;
const APPROVAL_PERMISSION_RE =
  /\b(?:approval|permission|guardrail|policy|canUseTool|writeScope|secret|credential)\b/i;
const CHANNEL_DELIVERY_RE =
  /\b(?:channel|transport|deliver|sendMessage|postMessage|webhook|inboundSignal|callback)\b/i;
const DAEMON_ROUTE_RE =
  /\b(?:jsonResponse|controlRoute|route|req|res|server|daemon)\b/i;
const WORKFLOW_STEP_RE =
  /\b(?:typedCodeStep|WorkflowStep|stepSucceeded|stepOutputs?|stepResults?|repairLoop|triggerWorkflow|workflow\.step|workflow\.completed)\b/;
const AGENT_HARNESS_RE =
  /\b(?:AgentHarness|agentConfig|executeAgentStep|runAgent|harness|model|sessionId|trajectoryDiagnostics)\b/;

const STRUCTURED_LOG_RE =
  /\b(?:ctx\.log|log|logger)\.(?:debug|info|warn|error)\s*\([\s\S]{0,240}?,\s*\{/m;
const TYPED_EVENT_RE =
  /\b(?:ctx\.events|deps\.pbus|pbus|bus|context)\.emit\s*\(|\bemit\s*\(\s*[A-Za-z][A-Za-z0-9]*(?:Event)?\b/;
const RUN_ARTIFACT_RE =
  /\bwrite[A-Za-z0-9]*Artifact\s*\(|\b(?:writeJsonFileAtomic|writeFileSync)\s*\([\s\S]{0,180}\b(?:runDirPath|workflow\.runDirPath|runDir|\.kota\/runs)\b/m;
const EXPLICIT_ERROR_RESULT_RE =
  /\breturn\s+\{[\s\S]{0,240}\b(?:error|reason|message)\s*:|\b(?:error|reason|message)\s*:\s*(?:error|err|String\(|formatErrorMessage)/m;
const TEST_ASSERTION_RE = /\b(?:expect\s*\(|assert(?:\.\w+)?\s*\()/;
const TEST_OBSERVABILITY_TERM_RE =
  /\b(?:log|event|emit|artifact|warning|error|failure|status|metadata|effect|risk|observable|observability|diagnostic)\b/i;

const REASON_RULES: ReasonRule[] = [
  {
    kind: "error-handling",
    message: "changed runtime error handling or failure-state behavior",
    matches: (file, changedText) =>
      isRuntimeSensitiveSurface(file) && ERROR_HANDLING_RE.test(changedText),
  },
  {
    kind: "retry-recovery",
    message: "changed retry, recovery, timeout, abort, or restart behavior",
    matches: (file, changedText) =>
      (isRuntimeSensitiveSurface(file) || /(?:retry|recover|recovery|timeout)/i.test(file)) &&
      RETRY_RECOVERY_RE.test(changedText),
  },
  {
    kind: "external-call",
    message: "changed an external process, network, or delivery call path",
    matches: (_file, changedText) => EXTERNAL_CALL_RE.test(changedText),
  },
  {
    kind: "tool-execution",
    message: "changed tool execution, tool policy, or tool telemetry behavior",
    matches: (file, changedText) =>
      /(?:^|\/)(?:tools?|tool-|.*tool.*)\//.test(file) ||
      TOOL_EXECUTION_RE.test(changedText),
  },
  {
    kind: "approval-permission",
    message: "changed approval, permission, guardrail, secret, or credential behavior",
    matches: (file, changedText) =>
      /(?:approval|permission|guardrail|secret|credential)/i.test(file) ||
      APPROVAL_PERMISSION_RE.test(changedText),
  },
  {
    kind: "channel-delivery",
    message: "changed channel delivery, webhook, callback, or transport behavior",
    matches: (file, changedText) =>
      /(?:channel|slack|telegram|webhook|inbound|transport|delivery)/i.test(file) ||
      CHANNEL_DELIVERY_RE.test(changedText),
  },
  {
    kind: "daemon-route",
    message: "changed daemon route, server, request, or response handling",
    matches: (file, changedText) =>
      /(?:^src\/core\/(?:daemon|server)\/|routes?|control-routes?)/.test(file) ||
      DAEMON_ROUTE_RE.test(changedText),
  },
  {
    kind: "workflow-step-transition",
    message: "changed workflow step state, trigger, or repair-loop behavior",
    matches: (file, changedText) =>
      /(?:^src\/core\/workflow\/|\/workflows?\/)/.test(file) &&
      WORKFLOW_STEP_RE.test(changedText),
  },
  {
    kind: "agent-harness-execution",
    message: "changed agent harness execution, model, session, or trajectory behavior",
    matches: (file, changedText) =>
      /(?:harness|agent-harness|agent-client)/i.test(file) ||
      AGENT_HARNESS_RE.test(changedText),
  },
];

export function normalizeObservabilityPath(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function extensionOf(file: string): string {
  const name = file.split("/").pop() ?? file;
  if (name.endsWith(".d.ts")) return ".d.ts";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function isTestFile(file: string): boolean {
  return (
    /(?:^|\/)__tests__\//.test(file) ||
    /\.(?:test|spec|test-cases)\.[cm]?[jt]sx?$/.test(file) ||
    /\.integration\.[cm]?[jt]s$/.test(file)
  );
}

function isProductionSourcePath(file: string): boolean {
  const normalized = normalizeObservabilityPath(file);
  if (normalized.startsWith(".") && !normalized.startsWith("./")) return false;
  if (normalized.startsWith("data/tasks/") || normalized.startsWith("docs/")) {
    return false;
  }
  if (normalized.endsWith(".md") || normalized.endsWith(".json")) return false;
  if (isTestFile(normalized)) return false;
  const parts = normalized.split("/");
  if (parts.some((part) => EXCLUDED_PATH_PARTS.has(part))) return false;
  return SOURCE_EXTENSIONS.has(extensionOf(normalized));
}

function isRuntimeSensitiveSurface(file: string): boolean {
  return (
    /^src\/core\/(?:workflow|daemon|tools|server|events|mcp|agent-harness)\//.test(file) ||
    /^src\/modules\/[^/]+\/index\.[cm]?ts$/.test(file) ||
    /^src\/modules\/[^/]+\/.*(?:workflow|channel|harness|route|approval|permission|guardrail|recovery|delivery|webhook|transport|adapter|retry|scheduler).*\.tsx?$/.test(file)
  );
}

function changedText(fileDiff: FileDiff): string {
  return [...fileDiff.addedLines, ...fileDiff.deletedLines].join("\n");
}

function addedText(fileDiff: FileDiff): string {
  return fileDiff.addedLines.join("\n");
}

export function detectObservabilityReasons(
  fileDiff: FileDiff,
): ObservabilitySensitivityReason[] {
  const file = normalizeObservabilityPath(fileDiff.file);
  if (!isProductionSourcePath(file)) return [];
  const text = changedText(fileDiff);
  if (!text.trim()) return [];
  return REASON_RULES
    .filter((rule) => rule.matches(file, text))
    .map((rule) => ({ kind: rule.kind, message: rule.message }));
}

function pushEvidence(
  evidence: ObservabilityEvidence[],
  next: ObservabilityEvidence,
): void {
  if (evidence.some((item) => item.kind === next.kind && item.ref === next.ref)) {
    return;
  }
  evidence.push(next);
}

function relatedTestFile(candidateFile: string, testFile: string): boolean {
  const sourceBase = basename(candidateFile).replace(/\.[cm]?[jt]sx?$/, "");
  const testBase = basename(testFile);
  if (testBase.includes(sourceBase)) return true;
  const sourceDir = dirname(candidateFile);
  if (testFile.startsWith(`${sourceDir}/`)) return true;
  const moduleMatch = /^src\/modules\/([^/]+)\//.exec(candidateFile);
  if (moduleMatch) return testFile.startsWith(`src/modules/${moduleMatch[1]}/`);
  const coreMatch = /^src\/core\/([^/]+)\//.exec(candidateFile);
  if (coreMatch) return testFile.startsWith(`src/core/${coreMatch[1]}/`);
  return false;
}

function detectFocusedTestAssertion(
  candidateFile: string,
  fileDiffs: readonly FileDiff[],
): ObservabilityEvidence | null {
  for (const fileDiff of fileDiffs) {
    const file = normalizeObservabilityPath(fileDiff.file);
    if (!isTestFile(file) || !relatedTestFile(candidateFile, file)) continue;
    const text = addedText(fileDiff);
    if (!TEST_ASSERTION_RE.test(text) || !TEST_OBSERVABILITY_TERM_RE.test(text)) {
      continue;
    }
    return {
      kind: "focused-test-assertion",
      detail: "related test diff asserts an observable warning, error, event, artifact, or metadata result",
      ref: file,
    };
  }
  return null;
}

export function detectObservabilityEvidence(
  fileDiff: FileDiff,
  fileDiffs: readonly FileDiff[],
  rationaleByFile: ReadonlyMap<string, string>,
): ObservabilityEvidence[] {
  const file = normalizeObservabilityPath(fileDiff.file);
  const text = addedText(fileDiff);
  const evidence: ObservabilityEvidence[] = [];
  if (STRUCTURED_LOG_RE.test(text)) {
    pushEvidence(evidence, {
      kind: "structured-log",
      detail: "changed production diff adds a structured log call with fields",
      ref: file,
    });
  }
  if (TYPED_EVENT_RE.test(text)) {
    pushEvidence(evidence, {
      kind: "typed-event",
      detail: "changed production diff emits a typed runtime event",
      ref: file,
    });
  }
  if (RUN_ARTIFACT_RE.test(text)) {
    pushEvidence(evidence, {
      kind: "run-artifact",
      detail: "changed production diff writes a run artifact or artifact review payload",
      ref: file,
    });
  }
  if (EXPLICIT_ERROR_RESULT_RE.test(text)) {
    pushEvidence(evidence, {
      kind: "explicit-error-result",
      detail: "changed production diff returns an explicit error, reason, or message result",
      ref: file,
    });
  }
  const testAssertion = detectFocusedTestAssertion(file, fileDiffs);
  if (testAssertion) pushEvidence(evidence, testAssertion);
  if (rationaleByFile.has(file)) {
    pushEvidence(evidence, {
      kind: "run-artifact-rationale",
      detail: "run artifact records a rationale for no additional diagnostic signal",
      ref: OBSERVABILITY_OBLIGATION_RATIONALE_ARTIFACT,
    });
  }
  return evidence;
}
