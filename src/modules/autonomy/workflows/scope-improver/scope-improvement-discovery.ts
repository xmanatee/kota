import {
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { getRepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { ScopeImprovementRequest } from "./events.js";
import {
  computeScopeContentFingerprint,
  isScopePolicyEvidenceRef,
} from "./scope-fingerprint.js";
import {
  missingGuidanceCandidate,
  recentChangeCandidate,
} from "./scope-improvement-candidates.js";
import {
  readScopeImprovementConfig,
  readScopeImprovementState,
} from "./scope-improvement-state.js";
import {
  SCOPE_IMPROVEMENT_MAX_CHANGED_FILES_PER_RUN,
  type ScopeImprovementCandidate,
  type ScopeImprovementEvidence,
  type ScopeImprovementEvidencePacket,
  type ScopeImprovementInputs,
  type ScopeImprovementTriggerKind,
  type ScopeInstruction,
} from "./scope-improvement-types.js";

function triggerKind(trigger: WorkflowRunTrigger): ScopeImprovementTriggerKind {
  const payload = trigger.payload as ScopeImprovementRequest;
  if (payload.boundary === "initial-onboarding") return "initial-onboarding";
  if (payload.boundary === "content-policy-changed") {
    return "content-policy-changed";
  }
  return "explicit-request";
}

function changedFiles(trigger: WorkflowRunTrigger): string[] {
  const files = trigger.payload.evidenceRefs;
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

export function collectScopeImprovementInputs(args: {
  projectDir: string;
  trigger: WorkflowRunTrigger;
  now: Date;
  scopePolicySnapshot: ScopePolicySnapshot;
}): ScopeImprovementInputs {
  const scopeId = deriveDirectoryScopeId(args.projectDir);
  const config = readScopeImprovementConfig(args.projectDir);
  const state = readScopeImprovementState(args.projectDir, scopeId);
  const payload = args.trigger.payload as ScopeImprovementRequest;
  const computedFingerprint = computeScopeContentFingerprint(
    args.projectDir,
    args.scopePolicySnapshot.policy,
  );
  const automatic = payload.automatic === true;
  // Automatic requests are latest-only semantic inputs. Re-read their
  // canonical state at execution so a guidance change between queueing and
  // consumption cannot make a stale payload authoritative.
  const fingerprint = automatic
    ? computedFingerprint.fingerprint
    : payload.fingerprint ?? computedFingerprint.fingerprint;
  const evidenceRefs = automatic
    ? computedFingerprint.refs
    : changedFiles(args.trigger);
  const files = evidenceRefs.filter((ref) => !isScopePolicyEvidenceRef(ref));
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
    {
      id: "policy:scope-authority",
      kind: "policy",
      summary:
        `resolved scope policy revision=${args.scopePolicySnapshot.revision} ` +
        `autonomy=${args.scopePolicySnapshot.policy.autonomy.defaultMode}/` +
        `${args.scopePolicySnapshot.policy.autonomy.maxMode} ` +
        `writes=${args.scopePolicySnapshot.policy.writes.mode}`,
    },
    {
      id: "policy:scope-improvement",
      kind: "policy",
      summary: `enabled=${config.enabled} maxActionsPerRun=${config.maxActionsPerRun}`,
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
    semanticInput: {
      automatic,
      fingerprint,
      evidenceRefs,
    },
    alreadyConsumed: automatic && state.consumedFingerprint === fingerprint,
  };
}

export function discoverScopeImprovementCandidates(
  inputs: ScopeImprovementInputs,
): ScopeImprovementCandidate[] {
  if (!inputs.config.enabled || inputs.alreadyConsumed) return [];
  const candidates: ScopeImprovementCandidate[] = [];
  const skippedCandidates: ScopeImprovementCandidate[] = [];
  const hasInstructions = inputs.instructions.length > 0;
  if (!hasInstructions) candidates.push(missingGuidanceCandidate(inputs));
  if (hasInstructions && inputs.changedFiles.length > 0) {
    const candidate = recentChangeCandidate(inputs);
    if (candidate.preferredAction === "skip") {
      skippedCandidates.push(candidate);
    } else {
      candidates.push(candidate);
    }
  }
  return [...candidates, ...skippedCandidates].slice(0, inputs.config.maxActionsPerRun);
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
