import { existsSync } from "node:fs";
import { join } from "node:path";
import type { EventJsonValue } from "#core/events/event-journal.js";
import {
  type AgentMessageStreamPolicy,
  artifactRef,
  boolField,
  type CoverageEvent,
  fileNonEmpty,
  isJsonObject,
  numberField,
  readJsonObject,
  runArtifactRef,
  stringField,
} from "./control-monitor-coverage-readers.js";
import {
  type ReviewerLinks,
  reviewerLinks,
} from "./control-monitor-coverage-reviewers.js";
import type {
  ControlCoverageFamilyBuilder,
  ControlCoverageFamilyName,
} from "./control-monitor-coverage-types.js";
import type { WorkflowRunMetadata } from "./run-types.js";

type FamilyAccessor = (name: ControlCoverageFamilyName) => ControlCoverageFamilyBuilder;
type AddGap = (
  family: ControlCoverageFamilyName,
  reason: string,
  subject: string,
  refs: string[],
  severity?: "warning" | "error",
) => void;

function addEvidence(family: ControlCoverageFamilyBuilder, ref: string | null): void {
  if (ref) family.evidenceRefs.push(ref);
}

function countField(raw: EventJsonValue | undefined, field: string): number {
  return isJsonObject(raw) ? numberField(raw[field]) ?? 0 : 0;
}

function trajectoryArtifactPath(runDirPath: string, stepId: string): string {
  return join(runDirPath, "steps", `${stepId}.trajectory-diagnostics.json`);
}

function missingStreamingFrameCount(runDirPath: string, stepId: string): number {
  const artifact = readJsonObject(trajectoryArtifactPath(runDirPath, stepId));
  return countField(artifact?.counts, "missingStreamingFramesCount");
}

function policyBlockedCount(events: readonly CoverageEvent[]): number {
  return events.filter((event) => {
    const policy = stringField(event.payload.policy);
    return policy === "deny" || policy === "queue" || policy === "confirm";
  }).length;
}

function matchEventsToToolNames(
  events: readonly CoverageEvent[],
  tools: readonly string[],
): {
  matchedCount: number;
  missingToolCount: number;
  unattributedEvents: CoverageEvent[];
} {
  const unmatchedTools = new Map<string, number>();
  for (const tool of tools) {
    unmatchedTools.set(tool, (unmatchedTools.get(tool) ?? 0) + 1);
  }

  let matchedCount = 0;
  const unattributedEvents: CoverageEvent[] = [];
  for (const event of events) {
    const tool = stringField(event.payload.tool);
    const remaining = tool === null ? 0 : unmatchedTools.get(tool) ?? 0;
    if (remaining > 0 && tool !== null) {
      matchedCount += 1;
      if (remaining === 1) {
        unmatchedTools.delete(tool);
      } else {
        unmatchedTools.set(tool, remaining - 1);
      }
    } else {
      unattributedEvents.push(event);
    }
  }

  const missingToolCount = [...unmatchedTools.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  return { matchedCount, missingToolCount, unattributedEvents };
}

function approvalEventsById(
  events: readonly CoverageEvent[],
): Map<string, CoverageEvent> {
  const byId = new Map<string, CoverageEvent>();
  for (const event of events) {
    const id = stringField(event.payload.id);
    if (id !== null && !byId.has(id)) byId.set(id, event);
  }
  return byId;
}

export function inspectAgentStream(args: {
  projectDir: string;
  runDirPath: string;
  stepId: string;
  stepStatus: string | null;
  streamPolicy: AgentMessageStreamPolicy | null;
  family: FamilyAccessor;
  addGap: AddGap;
}): void {
  const stream = args.family("agent-step-stream");
  stream.denominator += 1;
  const capabilityPath = join(args.runDirPath, "steps", `${args.stepId}.harness-capability.json`);
  const capability = readJsonObject(capabilityPath);
  const capabilityRef = artifactRef(args.projectDir, capabilityPath);
  const eventsPath = join(args.runDirPath, "steps", `${args.stepId}.events.jsonl`);
  const trajectoryPath = trajectoryArtifactPath(args.runDirPath, args.stepId);
  if (boolField(capability?.emitsAgentMessageStream) === false) {
    args.addGap("agent-step-stream", "unsupported-agent-message-stream", args.stepId, [capabilityRef]);
  } else if (fileNonEmpty(eventsPath)) {
    stream.numerator += 1;
    addEvidence(stream, artifactRef(args.projectDir, eventsPath));
  } else if (
    args.stepStatus === "failed" &&
    args.streamPolicy === "buffer-until-validation-success"
  ) {
    stream.pending += 1;
    addEvidence(stream, capabilityRef);
    addEvidence(stream, artifactRef(args.projectDir, join(args.runDirPath, "steps", `${args.stepId}.json`)));
  } else {
    const missingFrames = missingStreamingFrameCount(args.runDirPath, args.stepId);
    if (missingFrames > 0) {
      stream.numerator += 1;
      stream.warned += missingFrames;
      addEvidence(stream, artifactRef(args.projectDir, trajectoryPath));
      return;
    }
    args.addGap("agent-step-stream", "missing-agent-step-events", args.stepId, [capabilityRef]);
  }
}

export function inspectAutonomyMode(args: {
  projectDir: string;
  runDirPath: string;
  stepId: string;
  mode: string | null;
  family: FamilyAccessor;
  addGap: AddGap;
}): void {
  const autonomy = args.family("autonomy-mode");
  autonomy.denominator += 1;
  if (args.mode === "autonomous" || args.mode === "supervised" || args.mode === "passive") {
    autonomy.numerator += 1;
    addEvidence(autonomy, runArtifactRef(args.projectDir, args.runDirPath, "workflow.json"));
  } else {
    args.addGap("autonomy-mode", "missing-agent-step-autonomy-mode", args.stepId, [
      runArtifactRef(args.projectDir, args.runDirPath, "workflow.json"),
    ], "error");
  }
}

export function inspectTrajectory(args: {
  projectDir: string;
  runDirPath: string;
  stepId: string;
  stepStatus: string | null;
  streamPolicy: AgentMessageStreamPolicy | null;
  family: FamilyAccessor;
  addGap: AddGap;
}): void {
  const trajectory = args.family("trajectory-diagnostics");
  trajectory.denominator += 1;
  const path = trajectoryArtifactPath(args.runDirPath, args.stepId);
  const artifact = readJsonObject(path);
  if (!artifact) {
    if (
      args.stepStatus === "failed" &&
      args.streamPolicy === "buffer-until-validation-success"
    ) {
      trajectory.pending += 1;
      addEvidence(trajectory, artifactRef(args.projectDir, join(args.runDirPath, "steps", `${args.stepId}.json`)));
      return;
    }
    args.addGap("trajectory-diagnostics", "missing-trajectory-diagnostics", args.stepId, [
      runArtifactRef(args.projectDir, args.runDirPath, "metadata.json"),
    ]);
    return;
  }
  const counts = readJsonObject(path)?.counts;
  trajectory.warned += countField(counts, "warningCount");
  if (stringField(artifact.status) === "unsupported") {
    args.addGap("trajectory-diagnostics", "unsupported-trajectory-diagnostics", args.stepId, [
      artifactRef(args.projectDir, path),
    ]);
    return;
  }
  trajectory.numerator += 1;
  addEvidence(trajectory, artifactRef(args.projectDir, path));
}

export function inspectToolPolicy(args: {
  projectDir: string;
  runDirPath: string;
  toolCallTools: string[];
  guardrailEvents: CoverageEvent[];
  family: FamilyAccessor;
  addGap: AddGap;
}): void {
  const toolPolicy = args.family("tool-policy");
  const matches = matchEventsToToolNames(args.guardrailEvents, args.toolCallTools);
  toolPolicy.denominator = args.toolCallTools.length + matches.unattributedEvents.length;
  toolPolicy.numerator = matches.matchedCount;
  toolPolicy.blocked = policyBlockedCount(args.guardrailEvents);
  for (const event of args.guardrailEvents) addEvidence(toolPolicy, event.evidenceRef);
  if (matches.missingToolCount > 0) {
    args.addGap("tool-policy", "missing-tool-policy-decision-evidence", `${matches.missingToolCount} tool call(s)`, [
      runArtifactRef(args.projectDir, args.runDirPath, "metadata.json"),
    ]);
  }
  if (matches.unattributedEvents.length > 0) {
    args.addGap(
      "tool-policy",
      "unattributed-tool-policy-decision-event",
      `${matches.unattributedEvents.length} guardrail/control event(s)`,
      matches.unattributedEvents.map((event) => event.evidenceRef),
    );
  }
}

export function inspectInjectionDefense(args: {
  projectDir: string;
  runDirPath: string;
  externalPayloadTools: string[];
  injectionEvents: CoverageEvent[];
  family: FamilyAccessor;
  addGap: AddGap;
}): void {
  const injection = args.family("injection-defense");
  const matches = matchEventsToToolNames(args.injectionEvents, args.externalPayloadTools);
  injection.denominator = args.externalPayloadTools.length + matches.unattributedEvents.length;
  injection.numerator = matches.matchedCount;
  injection.warned = args.injectionEvents.filter((event) =>
    boolField(event.payload.suspicious) === true
  ).length;
  for (const event of args.injectionEvents) addEvidence(injection, event.evidenceRef);
  if (matches.missingToolCount > 0) {
    args.addGap("injection-defense", "external-payload-unscreened", `${matches.missingToolCount} external payload(s)`, [
      runArtifactRef(args.projectDir, args.runDirPath, "metadata.json"),
    ], "error");
  }
  if (matches.unattributedEvents.length > 0) {
    args.addGap(
      "injection-defense",
      "unattributed-injection-defense-event",
      `${matches.unattributedEvents.length} injection-defense event(s)`,
      matches.unattributedEvents.map((event) => event.evidenceRef),
    );
  }
}

export function inspectApprovalOwnerGates(args: {
  projectDir: string;
  runDirPath: string;
  steps: WorkflowRunMetadata["steps"];
  approvalRequestedEvents: CoverageEvent[];
  approvalResolvedEvents: CoverageEvent[];
  family: FamilyAccessor;
  addGap: AddGap;
}): number {
  const approvals = args.family("approval-owner-gates");
  const requestedById = approvalEventsById(args.approvalRequestedEvents);
  const resolvedById = approvalEventsById(args.approvalResolvedEvents);
  approvals.denominator = args.steps.length + requestedById.size;
  for (const step of args.steps) {
    const ref = artifactRef(args.projectDir, join(args.runDirPath, "steps", `${step.id}.json`));
    if (step.status === "success") {
      approvals.numerator += 1;
      addEvidence(approvals, ref);
    } else {
      approvals.blocked += 1;
      args.addGap("approval-owner-gates", "approval-or-owner-gate-unresolved", step.id, [ref]);
    }
  }
  for (const [id, requested] of requestedById) {
    const resolved = resolvedById.get(id);
    addEvidence(approvals, requested.evidenceRef);
    if (resolved) {
      approvals.numerator += 1;
      addEvidence(approvals, resolved.evidenceRef);
      if (boolField(resolved.payload.approved) === false) approvals.blocked += 1;
    } else {
      approvals.pending += 1;
    }
  }
  return args.steps.filter((step) => step.type === "approval").length + requestedById.size;
}

export function inspectRuntimeProbe(args: {
  projectDir: string;
  runDirPath: string;
  family: FamilyAccessor;
}): number {
  const probe = args.family("runtime-probe");
  if (!existsSync(join(args.runDirPath, "runtime-probe.json"))) return 0;
  probe.denominator = 1;
  probe.numerator = 1;
  addEvidence(probe, runArtifactRef(args.projectDir, args.runDirPath, "runtime-probe.json"));
  return 1;
}

export function inspectAsyncReviewers(args: {
  projectDir: string;
  runDirPath: string;
  metadata: WorkflowRunMetadata;
  family: FamilyAccessor;
}): ReviewerLinks {
  const asyncReview = args.family("async-reviewers");
  const links = reviewerLinks(args);
  if (links.evidenceRefs.length > 0) {
    asyncReview.denominator = 1;
    asyncReview.numerator = 1;
    links.evidenceRefs.forEach((ref) => addEvidence(asyncReview, ref));
  } else if ((args.metadata.tags ?? []).includes("monitored")) {
    asyncReview.denominator = 1;
    asyncReview.pending = 1;
  }
  return links;
}
