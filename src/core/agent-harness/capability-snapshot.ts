import type { HarnessHookKind } from "./hooks.js";
import type {
  AgentHarnessAuthProbe,
  AgentHarnessModelEffortReadiness,
  AgentHarnessReadiness,
  AgentHarnessReadinessRequest,
  AgentHarnessRuntimeProbe,
  AgentHarnessUnsupportedOption,
  AgentHarnessUnsupportedRunOption,
} from "./readiness.js";
import type { AgentHarness } from "./types.js";

export type HarnessCapabilityUnsupportedRunOption = {
  readonly option: string;
  readonly runOption?: AgentHarnessUnsupportedRunOption;
  readonly reason: string;
};

export type HarnessCapabilitySnapshot = {
  readonly harnessName: string;
  readonly toolControl: AgentHarness["toolControl"];
  readonly nativeAbortQuarantine: AgentHarness["nativeAbortQuarantine"] | null;
  readonly supportsMultiTurn: boolean;
  readonly askOwnerToolName: string | null;
  readonly emitsAgentMessageStream: boolean;
  readonly supportedHookKinds: readonly HarnessHookKind[];
  readonly unsupportedRunOptions: readonly HarnessCapabilityUnsupportedRunOption[];
  readonly localReadiness?: AgentHarnessReadiness;
};

export type HarnessRequiredReadinessFailure = {
  readonly surface:
    | "localRuntime"
    | "localAuth"
    | "modelEffort"
    | "optionalRuntime";
  readonly kind:
    | AgentHarnessRuntimeProbe["kind"]
    | AgentHarnessAuthProbe["kind"]
    | AgentHarnessModelEffortReadiness["kind"];
  readonly status: Exclude<
    | AgentHarnessRuntimeProbe["status"]
    | AgentHarnessAuthProbe["status"]
    | AgentHarnessModelEffortReadiness["status"],
    "ready" | "expiring"
  >;
  readonly summary: string;
};

export type HarnessCapabilityReadinessProbeSummary = {
  readonly kind:
    | AgentHarnessRuntimeProbe["kind"]
    | AgentHarnessAuthProbe["kind"]
    | AgentHarnessModelEffortReadiness["kind"];
  readonly status:
    | AgentHarnessRuntimeProbe["status"]
    | AgentHarnessAuthProbe["status"]
    | AgentHarnessModelEffortReadiness["status"];
  readonly required: boolean;
  readonly summary: string;
  readonly model?: string;
  readonly effort?: AgentHarnessModelEffortReadiness["effort"];
  readonly adapterModel?: string;
  readonly expiresAt?: string;
  readonly expiredAt?: string;
  readonly renewalSummary?: string;
};

export type HarnessCapabilityReadinessSummary = {
  readonly adapterKind: AgentHarnessReadiness["adapterKind"];
  readonly localRuntime: HarnessCapabilityReadinessProbeSummary;
  readonly localAuth?: HarnessCapabilityReadinessProbeSummary;
  readonly modelEffort?: HarnessCapabilityReadinessProbeSummary;
  readonly optionalRuntimes: readonly HarnessCapabilityReadinessProbeSummary[];
  readonly unsupportedOptions: readonly HarnessCapabilityUnsupportedRunOption[];
};

export type HarnessCapabilitySummary = {
  readonly toolControl: AgentHarness["toolControl"];
  readonly nativeAbortQuarantine: AgentHarness["nativeAbortQuarantine"] | null;
  readonly supportsMultiTurn: boolean;
  readonly supportsOwnerQuestions: boolean;
  readonly askOwnerToolName: string | null;
  readonly emitsAgentMessageStream: boolean;
  readonly supportedHookKinds: readonly HarnessHookKind[];
  readonly unsupportedRunOptions: readonly HarnessCapabilityUnsupportedRunOption[];
};

export type HarnessCapabilityArtifact = {
  readonly harnessName: string;
  readonly localReadiness?: HarnessCapabilityReadinessSummary;
} & HarnessCapabilitySummary;

function normalizeUnsupportedOptions(
  entries: readonly AgentHarnessUnsupportedOption[],
): HarnessCapabilityUnsupportedRunOption[] {
  return entries.map((entry) => ({
    option: entry.option,
    ...(entry.runOption !== undefined ? { runOption: entry.runOption } : {}),
    reason: entry.reason,
  }));
}

function unsupportedOptionKey(
  entry: HarnessCapabilityUnsupportedRunOption,
): string {
  return entry.runOption !== undefined
    ? `runOption:${entry.runOption}`
    : `option:${entry.option}`;
}

function mergeUnsupportedOptions(
  groups: readonly (readonly AgentHarnessUnsupportedOption[])[],
): HarnessCapabilityUnsupportedRunOption[] {
  const merged: HarnessCapabilityUnsupportedRunOption[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const entry of normalizeUnsupportedOptions(group)) {
      const key = unsupportedOptionKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
}

function summarizeProbe(
  probe:
    | AgentHarnessRuntimeProbe
    | AgentHarnessAuthProbe
    | AgentHarnessModelEffortReadiness,
): HarnessCapabilityReadinessProbeSummary {
  const expiryMetadata =
    probe.kind === "harness-managed-login" && probe.status === "expiring"
      ? {
          ...(probe.expiresAt !== undefined
            ? { expiresAt: probe.expiresAt }
            : {}),
          renewalSummary: probe.renewalSummary,
        }
      : probe.kind === "harness-managed-login" && probe.status === "stale"
        ? {
            ...(probe.expiredAt !== undefined
              ? { expiredAt: probe.expiredAt }
              : {}),
            renewalSummary: probe.renewalSummary,
          }
        : {};
  return {
    kind: probe.kind,
    status: probe.status,
    required: probe.required,
    summary: probe.summary,
    ...(probe.kind === "model-effort"
      ? {
          model: probe.model,
          effort: probe.effort,
          adapterModel: probe.adapterModel,
        }
      : {}),
    ...expiryMetadata,
  };
}

function summarizeReadiness(
  readiness: AgentHarnessReadiness,
): HarnessCapabilityReadinessSummary {
  return {
    adapterKind: readiness.adapterKind,
    localRuntime: summarizeProbe(readiness.localRuntime),
    ...(readiness.localAuth !== undefined
      ? { localAuth: summarizeProbe(readiness.localAuth) }
      : {}),
    ...(readiness.modelEffort !== undefined
      ? { modelEffort: summarizeProbe(readiness.modelEffort) }
      : {}),
    optionalRuntimes: readiness.optionalRuntimes.map(summarizeProbe),
    unsupportedOptions: normalizeUnsupportedOptions(readiness.unsupportedOptions),
  };
}

function appendRequiredReadinessFailure(
  failures: HarnessRequiredReadinessFailure[],
  surface: HarnessRequiredReadinessFailure["surface"],
  probe:
    | AgentHarnessRuntimeProbe
    | AgentHarnessAuthProbe
    | AgentHarnessModelEffortReadiness,
): void {
  if (
    !probe.required ||
    probe.status === "ready" ||
    probe.status === "expiring"
  ) {
    return;
  }
  failures.push({
    surface,
    kind: probe.kind,
    status: probe.status,
    summary: probe.summary,
  });
}

export function findRequiredHarnessReadinessFailures(
  snapshot: HarnessCapabilitySnapshot,
): HarnessRequiredReadinessFailure[] {
  const readiness = snapshot.localReadiness;
  if (readiness === undefined) return [];

  const failures: HarnessRequiredReadinessFailure[] = [];
  appendRequiredReadinessFailure(
    failures,
    "localRuntime",
    readiness.localRuntime,
  );
  if (readiness.localAuth !== undefined) {
    appendRequiredReadinessFailure(failures, "localAuth", readiness.localAuth);
  }
  if (readiness.modelEffort !== undefined) {
    appendRequiredReadinessFailure(
      failures,
      "modelEffort",
      readiness.modelEffort,
    );
  }
  for (const runtime of readiness.optionalRuntimes) {
    appendRequiredReadinessFailure(failures, "optionalRuntime", runtime);
  }
  return failures;
}

export function formatRequiredHarnessReadinessFailures(
  harnessName: string,
  failures: readonly HarnessRequiredReadinessFailure[],
): string {
  const details = failures
    .map(
      (failure) =>
        `${failure.surface} ${failure.status}: ${failure.summary}`,
    )
    .join("; ");
  return `Required agent harness "${harnessName}" readiness failed: ${details}`;
}

export function buildHarnessCapabilitySnapshot(
  harness: AgentHarness,
  request?: AgentHarnessReadinessRequest,
): HarnessCapabilitySnapshot {
  const localReadiness = harness.readiness?.(request);
  return {
    harnessName: harness.name,
    toolControl: harness.toolControl,
    nativeAbortQuarantine: harness.nativeAbortQuarantine ?? null,
    supportsMultiTurn: harness.supportsMultiTurn,
    askOwnerToolName: harness.askOwnerToolName,
    emitsAgentMessageStream: harness.emitsAgentMessageStream,
    supportedHookKinds: [...harness.supportedHookKinds],
    unsupportedRunOptions: mergeUnsupportedOptions([
      harness.unsupportedRunOptions ?? [],
      localReadiness?.unsupportedOptions ?? [],
    ]),
    ...(localReadiness !== undefined ? { localReadiness } : {}),
  };
}

export function summarizeHarnessCapability(
  snapshot: HarnessCapabilitySnapshot,
): HarnessCapabilitySummary {
  return {
    toolControl: snapshot.toolControl,
    nativeAbortQuarantine: snapshot.nativeAbortQuarantine,
    supportsMultiTurn: snapshot.supportsMultiTurn,
    supportsOwnerQuestions: snapshot.askOwnerToolName !== null,
    askOwnerToolName: snapshot.askOwnerToolName,
    emitsAgentMessageStream: snapshot.emitsAgentMessageStream,
    supportedHookKinds: snapshot.supportedHookKinds,
    unsupportedRunOptions: snapshot.unsupportedRunOptions,
  };
}

export function buildHarnessCapabilityArtifact(
  snapshot: HarnessCapabilitySnapshot,
): HarnessCapabilityArtifact {
  return {
    harnessName: snapshot.harnessName,
    ...summarizeHarnessCapability(snapshot),
    ...(snapshot.localReadiness !== undefined
      ? { localReadiness: summarizeReadiness(snapshot.localReadiness) }
      : {}),
  };
}
