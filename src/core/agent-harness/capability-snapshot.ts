import type { HarnessHookKind } from "./hooks.js";
import type {
  AgentHarnessAuthProbe,
  AgentHarnessReadiness,
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
  readonly supportsMultiTurn: boolean;
  readonly askOwnerToolName: string | null;
  readonly emitsAgentMessageStream: boolean;
  readonly supportedHookKinds: readonly HarnessHookKind[];
  readonly unsupportedRunOptions: readonly HarnessCapabilityUnsupportedRunOption[];
  readonly localReadiness?: AgentHarnessReadiness;
};

export type HarnessRequiredReadinessFailure = {
  readonly surface: "localRuntime" | "localAuth" | "optionalRuntime";
  readonly kind: AgentHarnessRuntimeProbe["kind"] | AgentHarnessAuthProbe["kind"];
  readonly status: Exclude<
    AgentHarnessRuntimeProbe["status"] | AgentHarnessAuthProbe["status"],
    "ready"
  >;
  readonly summary: string;
};

export type HarnessCapabilityReadinessProbeSummary = {
  readonly kind: AgentHarnessRuntimeProbe["kind"] | AgentHarnessAuthProbe["kind"];
  readonly status: AgentHarnessRuntimeProbe["status"] | AgentHarnessAuthProbe["status"];
  readonly required: boolean;
  readonly summary: string;
};

export type HarnessCapabilityReadinessSummary = {
  readonly adapterKind: AgentHarnessReadiness["adapterKind"];
  readonly localRuntime: HarnessCapabilityReadinessProbeSummary;
  readonly localAuth?: HarnessCapabilityReadinessProbeSummary;
  readonly optionalRuntimes: readonly HarnessCapabilityReadinessProbeSummary[];
  readonly unsupportedOptions: readonly HarnessCapabilityUnsupportedRunOption[];
};

export type HarnessCapabilitySummary = {
  readonly toolControl: AgentHarness["toolControl"];
  readonly supportsMultiTurn: boolean;
  readonly supportsOwnerQuestions: boolean;
  readonly askOwnerToolName: string | null;
  readonly emitsAgentMessageStream: boolean;
  readonly supportedHookKinds: readonly HarnessHookKind[];
  readonly unsupportedRunOptions: readonly HarnessCapabilityUnsupportedRunOption[];
  readonly localReadiness?: HarnessCapabilityReadinessSummary;
};

export type HarnessCapabilityArtifact = {
  readonly harnessName: string;
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
  probe: AgentHarnessRuntimeProbe | AgentHarnessAuthProbe,
): HarnessCapabilityReadinessProbeSummary {
  return {
    kind: probe.kind,
    status: probe.status,
    required: probe.required,
    summary: probe.summary,
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
    optionalRuntimes: readiness.optionalRuntimes.map(summarizeProbe),
    unsupportedOptions: normalizeUnsupportedOptions(readiness.unsupportedOptions),
  };
}

function appendRequiredReadinessFailure(
  failures: HarnessRequiredReadinessFailure[],
  surface: HarnessRequiredReadinessFailure["surface"],
  probe: AgentHarnessRuntimeProbe | AgentHarnessAuthProbe,
): void {
  if (!probe.required || probe.status === "ready") return;
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
): HarnessCapabilitySnapshot {
  const localReadiness = harness.readiness?.();
  return {
    harnessName: harness.name,
    toolControl: harness.toolControl,
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
    supportsMultiTurn: snapshot.supportsMultiTurn,
    supportsOwnerQuestions: snapshot.askOwnerToolName !== null,
    askOwnerToolName: snapshot.askOwnerToolName,
    emitsAgentMessageStream: snapshot.emitsAgentMessageStream,
    supportedHookKinds: snapshot.supportedHookKinds,
    unsupportedRunOptions: snapshot.unsupportedRunOptions,
    ...(snapshot.localReadiness !== undefined
      ? { localReadiness: summarizeReadiness(snapshot.localReadiness) }
      : {}),
  };
}

export function buildHarnessCapabilityArtifact(
  snapshot: HarnessCapabilitySnapshot,
): HarnessCapabilityArtifact {
  return {
    harnessName: snapshot.harnessName,
    ...summarizeHarnessCapability(snapshot),
  };
}
