import {
  type AgentHarnessAuthProbe,
  type AgentHarnessReadiness,
  type AgentHarnessReadinessRequest,
  type AgentHarnessRuntimeProbe,
  resolveAgentHarness,
} from "#core/agent-harness/index.js";
import type { ModelTiers } from "./model-router.js";
import {
  checkPresetAuth,
  mergePresetTiers,
  type Preset,
} from "./preset.js";

export type PresetAuthAlternativeReadiness = {
  readonly name: string;
  readonly present: boolean;
};

export type PresetAuthReadiness =
  | {
      readonly mode: "env";
      readonly ready: boolean;
      readonly alternatives: readonly PresetAuthAlternativeReadiness[];
      readonly missing: readonly string[];
      readonly summary: string;
    }
  | {
      readonly mode: "harness-managed-login";
      readonly ready: boolean;
      readonly alternatives: readonly [];
      readonly missing: readonly [];
      readonly probe: AgentHarnessAuthProbe;
      readonly summary: string;
    };

export type PresetHarnessReadiness = {
  readonly presetId: string;
  readonly harnessId: string;
  readonly defaultModel: string;
  readonly tiers: Required<ModelTiers>;
  readonly adapter: AgentHarnessReadiness;
  readonly auth: PresetAuthReadiness;
  readonly capturedAt: string;
};

export type PresetHarnessReadinessOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly tierOverrides?: ModelTiers;
  /** Exact runtime selection to probe; defaults to the preset's CLI default. */
  readonly selection?: AgentHarnessReadinessRequest;
  readonly now?: () => Date;
};

function missingHarnessReadiness(
  preset: Preset,
  detail: string,
): AgentHarnessReadiness {
  return {
    adapterKind: "unknown",
    localRuntime: {
      kind: "native-cli",
      status: "error",
      required: true,
      command: preset.harness,
      binaryName: preset.harness,
      detail,
      summary: `harness "${preset.harness}" readiness is unavailable: ${detail}`,
    },
    optionalRuntimes: [],
    unsupportedOptions: [],
  };
}

function collectAdapterReadiness(
  preset: Preset,
  selection: AgentHarnessReadinessRequest,
): AgentHarnessReadiness {
  try {
    const harness = resolveAgentHarness(preset.harness);
    if (!harness.readiness) {
      return missingHarnessReadiness(
        preset,
        `registered harness "${preset.harness}" does not declare readiness`,
      );
    }
    return harness.readiness(selection);
  } catch (err) {
    return missingHarnessReadiness(
      preset,
      err instanceof Error ? err.message : String(err),
    );
  }
}

function harnessManagedAuthSummary(
  probe: AgentHarnessAuthProbe,
  ready: boolean,
): string {
  if (probe.status === "expiring") {
    const expiresAt =
      probe.expiresAt !== undefined ? `, expiresAt=${probe.expiresAt}` : "";
    return (
      `harness-managed auth expiring (${probe.summary}${expiresAt}; ` +
      `${probe.renewalSummary})`
    );
  }
  if (probe.status === "stale") {
    const expiredAt =
      probe.expiredAt !== undefined ? `, expiredAt=${probe.expiredAt}` : "";
    return (
      `harness-managed auth stale (${probe.summary}${expiredAt}; ` +
      `${probe.renewalSummary})`
    );
  }
  if (ready) return `harness-managed auth ready (${probe.summary})`;
  if (probe.status === "unverifiable") {
    return `harness-managed auth unverifiable (${probe.summary})`;
  }
  return `harness-managed auth not ready (${probe.summary})`;
}

function collectAuthReadiness(
  preset: Preset,
  env: NodeJS.ProcessEnv,
  adapter: AgentHarnessReadiness,
): PresetAuthReadiness {
  if (preset.authEnv.length === 0) {
    const probe = adapter.localAuth ?? {
      kind: "harness-managed-login",
      status: "error",
      required: true,
      command: `${preset.harness} auth status`,
      detail: `registered harness "${preset.harness}" does not declare a local auth probe`,
      summary:
        `harness-managed auth readiness is unavailable for "${preset.harness}"`,
    } satisfies AgentHarnessAuthProbe;
    const ready =
      !probe.required ||
      probe.status === "ready" ||
      probe.status === "expiring";
    return {
      mode: "harness-managed-login",
      ready,
      alternatives: [],
      missing: [],
      probe,
      summary: harnessManagedAuthSummary(probe, ready),
    };
  }

  const alternatives = preset.authEnv.map((name) => ({
    name,
    present: Boolean(env[name]),
  }));
  const auth = checkPresetAuth(preset, env);
  if (auth.missing.length === 0) {
    const present = alternatives
      .filter((entry) => entry.present)
      .map((entry) => entry.name);
    return {
      mode: "env",
      ready: true,
      alternatives,
      missing: [],
      summary: `env auth ready (${present.join(" or ")})`,
    };
  }
  return {
    mode: "env",
    ready: false,
    alternatives,
    missing: auth.missing,
    summary: `missing one of ${auth.missing.join(" or ")}`,
  };
}

function requiredRuntimeReady(probe: AgentHarnessRuntimeProbe): boolean {
  return !probe.required || probe.status === "ready";
}

export function isPresetHarnessReadinessReady(
  readiness: PresetHarnessReadiness,
): boolean {
  return (
    readiness.auth.ready &&
    requiredRuntimeReady(readiness.adapter.localRuntime) &&
    (readiness.adapter.modelEffort === undefined ||
      readiness.adapter.modelEffort.status === "ready")
  );
}

export function collectPresetHarnessReadiness(
  preset: Preset,
  options: PresetHarnessReadinessOptions = {},
): PresetHarnessReadiness {
  const adapter = collectAdapterReadiness(
    preset,
    options.selection ?? {
      model: preset.defaultModel,
      effort: preset.defaultEffort,
    },
  );
  return {
    presetId: preset.id,
    harnessId: preset.harness,
    defaultModel: preset.defaultModel,
    tiers: mergePresetTiers(preset, options.tierOverrides),
    adapter,
    auth: collectAuthReadiness(preset, options.env ?? process.env, adapter),
    capturedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
}
