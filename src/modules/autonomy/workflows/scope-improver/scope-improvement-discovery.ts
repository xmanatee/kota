import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import { scopeImprovementRequested } from "./events.js";
import {
  readScopeImprovementConfig,
  readScopeImprovementState,
} from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_MAX_CHANGED_FILES_PER_RUN,
  SCOPE_IMPROVEMENT_SCHEDULE_EVENT,
  type ScopeImprovementCandidate,
  type ScopeImprovementConfig,
  type ScopeImprovementEvidence,
  type ScopeImprovementEvidencePacket,
  type ScopeImprovementInputs,
  type ScopeImprovementState,
  type ScopeImprovementTriggerKind,
  type ScopeInstruction,
} from "./scope-improvement-types.js";

function triggerKind(trigger: WorkflowRunTrigger): ScopeImprovementTriggerKind {
  const event = sourceTriggerEvent(trigger);
  if (event === "files.changed") return "file";
  if (event === "task.changed") return "task";
  if (event === "workflow.build.committed") return "run";
  if (event === SCOPE_IMPROVEMENT_SCHEDULE_EVENT || event === "schedule") {
    return "schedule";
  }
  if (event === scopeImprovementRequested.name) return "manual";
  return "manual";
}

function sourceTriggerEvent(trigger: WorkflowRunTrigger): string {
  if (trigger.event !== WORKFLOW_BATCH_FLUSH_EVENT) return trigger.event;
  const sourceEventName = trigger.payload.sourceEventName;
  return typeof sourceEventName === "string" ? sourceEventName : trigger.event;
}

function changedFiles(trigger: WorkflowRunTrigger): string[] {
  const files = trigger.payload.files;
  if (!Array.isArray(files)) return [];
  return files.filter((file): file is string => typeof file === "string");
}

function instructionPathsForFiles(files: readonly string[]): string[] {
  const paths = new Set(["AGENTS.md"]);
  for (const file of files) {
    const parts = file.split("/").filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      paths.add(join(...parts.slice(0, i), "AGENTS.md"));
    }
  }
  return [...paths].sort();
}

function readInstructions(projectDir: string, files: readonly string[]): ScopeInstruction[] {
  const instructions: ScopeInstruction[] = [];
  for (const path of instructionPathsForFiles(files)) {
    const fullPath = join(projectDir, path);
    if (!existsSync(fullPath)) continue;
    const raw = readFileSync(fullPath, "utf-8").trim();
    instructions.push({ path, excerpt: raw.slice(0, 800) });
  }
  return instructions;
}

function recentRunEvidence(projectDir: string): ScopeImprovementEvidence[] {
  const runsDir = join(projectDir, ".kota", "runs");
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .sort()
    .reverse()
    .slice(0, 8)
    .flatMap((runId) => {
      const metadata = readOptionalJsonFile<{
        workflow?: string;
        status?: string;
      }>(join(runsDir, runId, "metadata.json"));
      if (!metadata || metadata.status !== "failed") return [];
      return [
        {
          id: `run:${runId}`,
          kind: "run" as const,
          summary: `Failed workflow run ${metadata.workflow ?? "unknown"} (${runId})`,
          path: join(".kota", "runs", runId, "metadata.json"),
        },
      ];
    });
}

function queueEvidence(projectDir: string): ScopeImprovementEvidence {
  const snapshot = getRepoTaskQueueSnapshot(projectDir);
  return {
    id: "queue:snapshot",
    kind: "queue",
    summary:
      `Task queue open=${snapshot.openCount} actionable=${snapshot.actionableCount} ` +
      `pullable=${snapshot.pullableCount}`,
  };
}

function throttleDecision(
  config: ScopeImprovementConfig,
  state: ScopeImprovementState,
  files: readonly string[],
  now: Date,
): ScopeImprovementInputs["throttle"] {
  if (files.length > SCOPE_IMPROVEMENT_MAX_CHANGED_FILES_PER_RUN) {
    return {
      reason:
        `file event included ${files.length} paths; limit is ` +
        `${SCOPE_IMPROVEMENT_MAX_CHANGED_FILES_PER_RUN}`,
      eventCount: files.length,
    };
  }
  if (!state.lastRunAt) return null;
  const elapsedMinutes = (now.getTime() - Date.parse(state.lastRunAt)) / 60_000;
  if (!Number.isFinite(elapsedMinutes) || elapsedMinutes >= config.minMinutesBetweenRuns) {
    return null;
  }
  return {
    reason:
      `last scope improvement ran ${elapsedMinutes.toFixed(1)} minutes ago; ` +
      `minimum is ${config.minMinutesBetweenRuns}`,
    eventCount: files.length,
  };
}

export function collectScopeImprovementInputs(args: {
  projectDir: string;
  trigger: WorkflowRunTrigger;
  now: Date;
}): ScopeImprovementInputs {
  const scopeId = deriveDirectoryScopeId(args.projectDir);
  const config = readScopeImprovementConfig(args.projectDir);
  const state = readScopeImprovementState(args.projectDir, scopeId);
  const files = changedFiles(args.trigger);
  const instructions = readInstructions(args.projectDir, files);
  const evidence: ScopeImprovementEvidence[] = [
    ...instructions.map((item) => ({
      id: `instruction:${item.path}`,
      kind: "instruction" as const,
      summary: `Scoped instruction file ${item.path}`,
      path: item.path,
    })),
    ...files.slice(0, SCOPE_IMPROVEMENT_MAX_CHANGED_FILES_PER_RUN).map((path, index) => ({
      id: `file:${index}:${path}`,
      kind: "file" as const,
      summary: `Changed file ${path}`,
      path,
    })),
    queueEvidence(args.projectDir),
    ...recentRunEvidence(args.projectDir),
    {
      id: "policy:scope-improvement",
      kind: "policy",
      summary:
        `enabled=${config.enabled} autonomousEdits=${config.allowAutonomousEdits} ` +
        `writePaths=${config.writePaths.join(",") || "(none)"}`,
    },
  ];
  return {
    generatedAt: args.now.toISOString(),
    triggerKind: triggerKind(args.trigger),
    triggerEvent: args.trigger.event,
    scope: {
      scopeId,
      displayName: args.projectDir.split("/").pop() ?? args.projectDir,
      directoryRoot: args.projectDir,
    },
    config,
    state,
    instructions,
    changedFiles: files,
    evidence,
    throttle: throttleDecision(config, state, files, args.now),
  };
}

export function discoverScopeImprovementCandidates(
  inputs: ScopeImprovementInputs,
): ScopeImprovementCandidate[] {
  if (!inputs.config.enabled || inputs.throttle) return [];
  const candidates: ScopeImprovementCandidate[] = [];
  const hasInstructions = inputs.instructions.length > 0;
  if (!hasInstructions) candidates.push(missingGuidanceCandidate(inputs));
  if (hasInstructions && inputs.changedFiles.length > 0) {
    candidates.push(recentChangeCandidate(inputs));
  }
  candidates.push(...failedRunCandidates(inputs));
  if (hasInstructions && inputs.triggerKind === "task") {
    candidates.push({
      id: "task-queue-review",
      signature: `${inputs.scope.scopeId}:task-queue-review`,
      title: `Review ${inputs.scope.displayName} task queue for improvement work`,
      summary:
        "A task queue event occurred; inspect whether the scoped queue now points at the right next improvement.",
      evidenceIds: ["queue:snapshot"],
      preferredAction: "create-task",
    });
  }
  return candidates.slice(0, inputs.config.maxActionsPerRun);
}

function missingGuidanceCandidate(
  inputs: ScopeImprovementInputs,
): ScopeImprovementCandidate {
  return {
    id: "missing-scope-guidance",
    signature: `${inputs.scope.scopeId}:missing-scope-guidance`,
    title: `Add scope guidance for ${inputs.scope.displayName}`,
    summary:
      "The scope has no AGENTS.md guidance, so improvement work lacks local constraints.",
    evidenceIds: ["policy:scope-improvement"],
    preferredAction: inputs.config.allowAutonomousEdits ? "safe-edit" : "owner-question",
  };
}

function recentChangeCandidate(
  inputs: ScopeImprovementInputs,
): ScopeImprovementCandidate {
  return {
    id: "recent-file-change-review",
    signature:
      `${inputs.scope.scopeId}:recent-file-change-review:` +
      inputs.changedFiles.join("|"),
    title: `Review recent scoped changes in ${inputs.scope.displayName}`,
    summary:
      "Recent scoped files changed; create a reviewable task to identify concrete improvement work.",
    evidenceIds: inputs.evidence
      .filter((item) => item.kind === "file")
      .map((item) => item.id),
    preferredAction: "create-task",
  };
}

function failedRunCandidates(
  inputs: ScopeImprovementInputs,
): ScopeImprovementCandidate[] {
  return inputs.evidence
    .filter((item) => item.kind === "run")
    .map((failure) => ({
      id: failure.id,
      signature: `${inputs.scope.scopeId}:${failure.id}`,
      title: `Investigate ${failure.summary}`,
      summary: "A failed run is evidence of scope work that may need repair.",
      evidenceIds: [failure.id],
      preferredAction: "create-task" as const,
    }));
}

export function gatherScopeImprovementEvidence(args: {
  inputs: ScopeImprovementInputs;
  candidates: ScopeImprovementCandidate[];
}): ScopeImprovementEvidencePacket {
  const cited = new Set(args.candidates.flatMap((candidate) => candidate.evidenceIds));
  return {
    generatedAt: args.inputs.generatedAt,
    scope: args.inputs.scope,
    triggerKind: args.inputs.triggerKind,
    triggerEvent: args.inputs.triggerEvent,
    evidence: args.inputs.evidence.filter(
      (item) => cited.has(item.id) || item.kind === "instruction" || item.kind === "policy",
    ),
    candidates: args.candidates,
  };
}
