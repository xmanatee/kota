import { createHash } from "node:crypto";
import type {
  AutonomyIssueLinks,
  AutonomyIssueObservation,
} from "./autonomy-issue-projection-types.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthEvidenceRef,
  AutonomyHealthJsonValue,
  AutonomyHealthObservation,
  AutonomyHealthSeverity,
  AutonomyHealthSignalSource,
} from "./health-signal.js";
import { isAutonomyHealthJsonObject } from "./health-signal.js";

const ROOT_CAUSE_KEY_RE = /^[a-z0-9][a-z0-9:._/-]*$/;

function hash(value: string, length = 20): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function stableJson(value: AutonomyHealthJsonValue | undefined): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isAutonomyHealthJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function uniqueAutonomyIssueStrings(
  values: readonly string[],
): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function uniqueAutonomyIssueEvidenceRefs(
  refs: readonly AutonomyHealthEvidenceRef[],
): AutonomyHealthEvidenceRef[] {
  const byRef = new Map<string, AutonomyHealthEvidenceRef>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.ref}`;
    const existing = byRef.get(key);
    if (existing?.summary !== undefined) continue;
    byRef.set(key, { ...ref });
  }
  return [...byRef.values()].sort((left, right) =>
    `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`),
  );
}

export function emptyAutonomyIssueLinks(): AutonomyIssueLinks {
  return {
    taskIds: [],
    ownerQuestionIds: [],
    deadLetterIds: [],
    recoveryDispositionRefs: [],
  };
}

export function stableAutonomyIssueKey(rootCauseKey: string): string {
  const normalized = rootCauseKey.trim().toLowerCase();
  if (!ROOT_CAUSE_KEY_RE.test(normalized)) {
    throw new Error("rootCauseKey must be a stable lowercase token path");
  }
  return `autonomy-issue-${hash(normalized)}`;
}

function linkedDeadLetterIds(
  refs: readonly AutonomyHealthEvidenceRef[],
): string[] {
  return uniqueAutonomyIssueStrings(
    refs.flatMap((ref) => {
      if (ref.kind !== "dead-letter") return [];
      const id = ref.ref.split("#").at(-1)?.trim();
      return id ? [id] : [];
    }),
  );
}

function linkedRecoveryDispositionRefs(
  refs: readonly AutonomyHealthEvidenceRef[],
): string[] {
  return uniqueAutonomyIssueStrings(
    refs
      .filter(
        (ref) =>
          ref.kind === "artifact" &&
          ref.ref.endsWith("/workflow-state-recovery.json"),
      )
      .map((ref) => ref.ref),
  );
}

export function buildAutonomyIssueObservation(args: {
  kind: AutonomyHealthObservation;
  rootCauseKey: string;
  observedAt: string;
  signalIds: readonly string[];
  source: AutonomyHealthSignalSource;
  severity: AutonomyHealthSeverity;
  actionability: AutonomyHealthActionability;
  labels: readonly string[];
  summaries: readonly string[];
  evidenceRefs: readonly AutonomyHealthEvidenceRef[];
  observationCount: number;
}): AutonomyIssueObservation {
  const rootCauseKey = args.rootCauseKey.trim().toLowerCase();
  const issueKey = stableAutonomyIssueKey(rootCauseKey);
  const labels = uniqueAutonomyIssueStrings(args.labels);
  const summaries = uniqueAutonomyIssueStrings(args.summaries);
  const evidenceRefs = uniqueAutonomyIssueEvidenceRefs(args.evidenceRefs);
  const semanticMaterial = {
    rootCauseKey,
    severity: args.severity,
    actionability: args.actionability,
    labels,
    source: {
      kind: args.source.kind,
      ...(args.source.module !== undefined ? { module: args.source.module } : {}),
      ...(args.source.workflow !== undefined
        ? { workflow: args.source.workflow }
        : {}),
      ...(args.source.stepId !== undefined ? { stepId: args.source.stepId } : {}),
    },
  };
  const semanticFingerprint = hash(
    stableJson(semanticMaterial as AutonomyHealthJsonValue),
  );
  const observationId = `observation-${hash(
    stableJson({
      issueKey,
      kind: args.kind,
      signalIds: uniqueAutonomyIssueStrings(args.signalIds),
    } as AutonomyHealthJsonValue),
  )}`;
  return {
    observationId,
    kind: args.kind,
    issueKey,
    rootCauseKey,
    observedAt: args.observedAt,
    source: { ...args.source },
    severity: args.severity,
    actionability: args.actionability,
    labels,
    summaries,
    evidenceRefs,
    observationCount: args.observationCount,
    semanticFingerprint,
    links: {
      deadLetterIds: linkedDeadLetterIds(evidenceRefs),
      recoveryDispositionRefs: linkedRecoveryDispositionRefs(evidenceRefs),
    },
  };
}
