import {
  type AgentHarnessAuthProbe,
  type AgentHarnessReadiness,
  redactAgentHarnessAuthDetail,
} from "#core/agent-harness/index.js";
import { loadConfig } from "#core/config/config.js";
import {
  mergePresetTiers,
  PRESET_ENV_VAR,
  resolvePreset,
} from "#core/model/preset.js";
import {
  collectPresetHarnessReadiness,
  isPresetHarnessReadinessReady,
  type PresetHarnessReadiness,
} from "#core/model/preset-readiness.js";
import type { DoctorCheckResult } from "./client.js";
import { fail, info, pass } from "./doctor-results.js";

function supportedCapabilitiesDetail(
  readiness: PresetHarnessReadiness,
): string {
  const capabilities = readiness.capabilities;
  if (capabilities === null) return "capability declaration unavailable";

  return [
    `toolControl=${capabilities.toolControl}`,
    ...(capabilities.supportsMultiTurn ? ["multiTurn"] : []),
    ...(capabilities.supportsOwnerQuestions ? ["ownerQuestions"] : []),
    ...(capabilities.emitsAgentMessageStream ? ["agentMessageStream"] : []),
    ...(capabilities.nativeAbortQuarantine === null
      ? []
      : [`cancellation=${capabilities.nativeAbortQuarantine}`]),
    ...(capabilities.supportedHookKinds.length === 0
      ? []
      : [`hooks=${capabilities.supportedHookKinds.join(",")}`]),
  ].join("; ");
}

function intentionalLimitsDetail(
  readiness: PresetHarnessReadiness,
): string {
  const capabilities = readiness.capabilities;
  if (capabilities === null) return "capability declaration unavailable";

  const limits = [
    ...(!capabilities.supportsMultiTurn ? ["multiTurn"] : []),
    ...(!capabilities.supportsOwnerQuestions ? ["ownerQuestions"] : []),
    ...(!capabilities.emitsAgentMessageStream ? ["agentMessageStream"] : []),
    ...capabilities.unsupportedRunOptions.map((option) => option.option),
  ];
  return limits.length === 0 ? "none" : limits.join(", ");
}

function runtimeProbeStatus(
  probe: PresetHarnessReadiness["adapter"]["localRuntime"],
): DoctorCheckResult["status"] {
  return probe.status === "ready" || !probe.required ? "pass" : "fail";
}

function runtimeProbeName(
  probe: PresetHarnessReadiness["adapter"]["localRuntime"],
): string {
  if (probe.kind === "native-cli") return probe.binaryName;
  if (probe.kind === "node-runtime") return "node";
  return probe.packageName;
}

function runtimeProbeDetail(
  probe: PresetHarnessReadiness["adapter"]["localRuntime"],
): string {
  return probe.status === "error" ? `${probe.summary} (${probe.detail})` : probe.summary;
}

function presetReadinessSummary(readiness: PresetHarnessReadiness): string {
  if (!readiness.auth.ready) return `auth ${readiness.auth.summary}`;
  if (readiness.adapter.localRuntime.required && readiness.adapter.localRuntime.status !== "ready") {
    return `runtime ${readiness.adapter.localRuntime.summary}`;
  }
  if (
    readiness.adapter.modelEffort !== undefined &&
    readiness.adapter.modelEffort.status !== "ready"
  ) {
    return `model/effort ${readiness.adapter.modelEffort.summary}`;
  }
  return `${readiness.auth.summary}; runtime ${readiness.adapter.localRuntime.summary}`;
}

function hasRequiredReadinessFailure(
  readiness: PresetHarnessReadiness,
): boolean {
  return (
    (readiness.adapter.localRuntime.required &&
      readiness.adapter.localRuntime.status !== "ready") ||
    (readiness.adapter.modelEffort !== undefined &&
      readiness.adapter.modelEffort.status !== "ready")
  );
}

function authCheckStatus(readiness: PresetHarnessReadiness): DoctorCheckResult["status"] {
  if (
    readiness.auth.mode === "harness-managed-login" &&
    (readiness.auth.probe.status === "expiring" || readiness.auth.probe.status === "unverifiable")
  ) {
    return "warn";
  }
  return readiness.auth.ready ? "pass" : "fail";
}

function redactAuthProbeMetadata(probe: AgentHarnessAuthProbe): AgentHarnessAuthProbe {
  return { ...probe, detail: redactAgentHarnessAuthDetail(probe.detail) };
}

function redactHarnessReadinessMetadata(
  readiness: AgentHarnessReadiness,
): AgentHarnessReadiness {
  const localAuth = readiness.localAuth === undefined
    ? undefined
    : redactAuthProbeMetadata(readiness.localAuth);
  return { ...readiness, ...(localAuth !== undefined ? { localAuth } : {}) };
}

function redactPresetReadinessMetadata(
  readiness: PresetHarnessReadiness,
): PresetHarnessReadiness {
  const adapter = redactHarnessReadinessMetadata(readiness.adapter);
  const auth = readiness.auth.mode === "harness-managed-login"
    ? { ...readiness.auth, probe: redactAuthProbeMetadata(readiness.auth.probe) }
    : readiness.auth;
  return { ...readiness, adapter, auth };
}

function renderPresetReadinessChecks(
  readiness: PresetHarnessReadiness,
  sourceLabel: string,
): DoctorCheckResult[] {
  const metadataReadiness = redactPresetReadinessMetadata(readiness);
  const sourceDetail =
    `source: ${sourceLabel}, harness: ${readiness.harnessId}, ` +
    `defaultModel: ${readiness.defaultModel}`;
  const authStatus = authCheckStatus(readiness);
  const presetStatus: DoctorCheckResult["status"] =
    authStatus === "warn" && !hasRequiredReadinessFailure(readiness)
      ? "warn"
      : isPresetHarnessReadinessReady(readiness)
        ? "pass"
        : "fail";
  const checks: DoctorCheckResult[] = [
    {
      label: `Preset: ${readiness.presetId}`,
      status: presetStatus,
      detail: `${presetReadinessSummary(readiness)} (${sourceDetail})`,
      metadata: { presetReadiness: metadataReadiness },
    },
    pass(
      `Preset tiers: ${readiness.presetId}`,
      `fast=${readiness.tiers.fast}, balanced=${readiness.tiers.balanced}, capable=${readiness.tiers.capable}`,
    ),
    pass(
      `Preset adapter: ${readiness.presetId}`,
      `kind=${readiness.adapter.adapterKind}, harness=${readiness.harnessId}`,
    ),
    {
      label: `Preset runtime: ${readiness.presetId}`,
      status: runtimeProbeStatus(readiness.adapter.localRuntime),
      detail: runtimeProbeDetail(readiness.adapter.localRuntime),
    },
  ];
  for (const optional of readiness.adapter.optionalRuntimes) {
    checks.push({
      label: `Preset optional runtime: ${readiness.presetId}/${runtimeProbeName(optional)}`,
      status: runtimeProbeStatus(optional),
      detail: runtimeProbeDetail(optional),
    });
  }
  if (readiness.adapter.modelEffort !== undefined) {
    const selection = readiness.adapter.modelEffort;
    checks.push({
      label: `Preset model/effort: ${readiness.presetId}`,
      status: selection.status === "ready" ? "pass" : "fail",
      detail:
        selection.status === "ready"
          ? selection.summary
          : `${selection.summary} (${selection.detail})`,
    });
  }
  checks.push({
    label: `Preset auth: ${readiness.presetId}`,
    status: authCheckStatus(readiness),
    detail: readiness.auth.summary,
  });
  checks.push({
    label: `Preset supported capabilities: ${readiness.presetId}`,
    status: readiness.capabilities === null ? "fail" : "pass",
    detail: supportedCapabilitiesDetail(readiness),
  });
  checks.push(
    readiness.capabilities === null
      ? fail(
          `Preset intentional limits: ${readiness.presetId}`,
          intentionalLimitsDetail(readiness),
        )
      : info(
          `Preset intentional limits: ${readiness.presetId}`,
          intentionalLimitsDetail(readiness),
        ),
  );
  return checks;
}

export function checkPresetHarnessReadiness(
  projectDir: string,
  requestedPresetId: string | undefined,
): DoctorCheckResult[] {
  const config = loadConfig(projectDir);
  let resolution: ReturnType<typeof resolvePreset>;
  try {
    resolution = resolvePreset({
      flag: requestedPresetId,
      env: process.env[PRESET_ENV_VAR],
      config: config.defaultPreset,
    });
  } catch (err) {
    return [fail("Preset", err instanceof Error ? err.message : String(err))];
  }
  const { preset, source } = resolution;
  const tiers = mergePresetTiers(preset, config.modelTiers);
  const readiness = collectPresetHarnessReadiness(preset, {
    tierOverrides: config.modelTiers,
    selection: {
      model: tiers.capable,
      effort: preset.defaultEffort,
    },
  });
  return renderPresetReadinessChecks(
    readiness,
    source === "default" ? "shipped default" : source,
  );
}

export function extractPresetReadiness(
  checks: readonly DoctorCheckResult[],
): PresetHarnessReadiness | undefined {
  for (const check of checks) {
    if (check.metadata?.presetReadiness) {
      return redactPresetReadinessMetadata(check.metadata.presetReadiness);
    }
  }
  return undefined;
}
