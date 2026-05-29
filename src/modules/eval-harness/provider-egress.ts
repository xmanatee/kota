import type { Preset } from "#core/model/preset.js";

export type ProviderEgressProvider = "anthropic" | "openai" | "google";

export type ProviderEgressEndpoint = {
  id: string;
  protocol: "https";
  host: string;
  port: 443;
};

export type ProviderEgressNetworkEnforcement = {
  kind: "docker-internal-proxy";
  networkName: string;
  proxyUrl: string;
};

export type ProviderEgressTaskSubprocessBoundary =
  | {
      kind: "kota-tool-provider-env-filter";
      agentHarness: string;
      providerProxyEnv: "stripped";
      providerAuthEnv: "stripped";
      networkBoundary: "shared-container-network";
      gateEligible: false;
    }
  | {
      kind: "native-tool-runtime-unverified";
      agentHarness: string;
      gateEligible: false;
    }
  | {
      kind: "agent-harness-unresolved";
      gateEligible: false;
    };

export type ProviderEgressTaskSubprocessBoundaryRequest = {
  agentHarness: string;
  toolControl: "kota" | "native";
};

export type ContainerNetworkPolicyRequest =
  | { kind: "offline" }
  | {
      kind: "provider-egress";
      provider: ProviderEgressProvider;
      enforcement: ProviderEgressNetworkEnforcement;
    };

export type ExecutionNetworkPolicy =
  | {
      kind: "host-subprocess";
      enforcementMode: "host-unverified";
      allowedProviderEndpoints: readonly [];
      gateEligible: false;
    }
  | {
      kind: "offline";
      enforcementMode: "docker-network-none";
      allowedProviderEndpoints: readonly [];
      gateEligible: true;
    }
  | {
      kind: "provider-egress";
      provider: ProviderEgressProvider;
      enforcementMode: "docker-internal-proxy";
      networkName: string;
      proxyUrl: string;
      allowedProviderEndpoints: readonly ProviderEgressEndpoint[];
      containerNetworkScope: "whole-container-provider-proxy";
      taskSubprocessBoundary: ProviderEgressTaskSubprocessBoundary;
      gateEligible: boolean;
    }
  | {
      kind: "provider-egress";
      provider: ProviderEgressProvider;
      enforcementMode: "unavailable";
      networkName: string;
      proxyUrl: string;
      allowedProviderEndpoints: readonly ProviderEgressEndpoint[];
      containerNetworkScope: "unavailable";
      taskSubprocessBoundary: ProviderEgressTaskSubprocessBoundary;
      gateEligible: false;
    };

export const HOST_SUBPROCESS_NETWORK_POLICY = {
  kind: "host-subprocess",
  enforcementMode: "host-unverified",
  allowedProviderEndpoints: [],
  gateEligible: false,
} as const satisfies ExecutionNetworkPolicy;

export const OFFLINE_CONTAINER_NETWORK_POLICY = {
  kind: "offline",
  enforcementMode: "docker-network-none",
  allowedProviderEndpoints: [],
  gateEligible: true,
} as const satisfies ExecutionNetworkPolicy;

const PROVIDER_ENDPOINTS: Readonly<Record<ProviderEgressProvider, readonly ProviderEgressEndpoint[]>> = {
  anthropic: [
    {
      id: "anthropic-api",
      protocol: "https",
      host: "api.anthropic.com",
      port: 443,
    },
  ],
  openai: [
    {
      id: "openai-api",
      protocol: "https",
      host: "api.openai.com",
      port: 443,
    },
    {
      id: "openai-chatgpt",
      protocol: "https",
      host: "chatgpt.com",
      port: 443,
    },
  ],
  google: [
    {
      id: "google-generative-language-api",
      protocol: "https",
      host: "generativelanguage.googleapis.com",
      port: 443,
    },
  ],
};

const PROVIDER_AUTH_ENV_KEYS: Readonly<Record<ProviderEgressProvider, readonly string[]>> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
};

const HARNESS_PROVIDER: Readonly<Record<string, ProviderEgressProvider>> = {
  "claude-agent-sdk": "anthropic",
  codex: "openai",
  "openai-tools": "openai",
  gemini: "google",
  "gemini-cli": "google",
  "antigravity-cli": "google",
};

export const PROVIDER_EGRESS_NETWORK_LABELS = {
  policy: "kota.egress.policy",
  provider: "kota.egress.provider",
  endpoints: "kota.egress.endpoints",
} as const;

export function providerEgressEndpointsFor(
  provider: ProviderEgressProvider,
): readonly ProviderEgressEndpoint[] {
  return PROVIDER_ENDPOINTS[provider];
}

export function providerEgressAuthEnvKeysFor(
  provider: ProviderEgressProvider,
): readonly string[] {
  return PROVIDER_AUTH_ENV_KEYS[provider];
}

export function providerEgressEndpointLabelValue(
  endpoints: readonly ProviderEgressEndpoint[],
): string {
  return endpoints
    .map((endpoint) => `${endpoint.protocol}://${endpoint.host}:${endpoint.port}`)
    .sort((a, b) => a.localeCompare(b))
    .join(",");
}

export function providerEgressProviderForPreset(
  preset: Pick<Preset, "id" | "harness">,
): ProviderEgressProvider {
  const provider = HARNESS_PROVIDER[preset.harness];
  if (provider === undefined) {
    throw new Error(
      `Preset "${preset.id}" uses harness "${preset.harness}", which has no eval-harness provider-egress endpoint catalog entry.`,
    );
  }
  return provider;
}

export function validateProviderEgressProxyUrl(proxyUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(proxyUrl);
  } catch {
    throw new Error("provider-egress proxy URL must be an absolute URL.");
  }
  if (parsed.protocol !== "http:") {
    throw new Error("provider-egress proxy URL must use http://.");
  }
  if (parsed.hostname.length === 0) {
    throw new Error("provider-egress proxy URL must include a host.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new Error("provider-egress proxy URL must not include credentials.");
  }
}

export function providerEgressTaskSubprocessBoundary(
  request: ProviderEgressTaskSubprocessBoundaryRequest | undefined,
): ProviderEgressTaskSubprocessBoundary {
  if (request === undefined) {
    return { kind: "agent-harness-unresolved", gateEligible: false };
  }
  if (request.toolControl === "kota") {
    return {
      kind: "kota-tool-provider-env-filter",
      agentHarness: request.agentHarness,
      providerProxyEnv: "stripped",
      providerAuthEnv: "stripped",
      networkBoundary: "shared-container-network",
      gateEligible: false,
    };
  }
  return {
    kind: "native-tool-runtime-unverified",
    agentHarness: request.agentHarness,
    gateEligible: false,
  };
}

export function enforcedProviderEgressNetworkPolicy(
  request: Extract<ContainerNetworkPolicyRequest, { kind: "provider-egress" }>,
  boundary: ProviderEgressTaskSubprocessBoundary,
): ExecutionNetworkPolicy {
  return {
    kind: "provider-egress",
    provider: request.provider,
    enforcementMode: "docker-internal-proxy",
    networkName: request.enforcement.networkName,
    proxyUrl: request.enforcement.proxyUrl,
    allowedProviderEndpoints: providerEgressEndpointsFor(request.provider),
    containerNetworkScope: "whole-container-provider-proxy",
    taskSubprocessBoundary: boundary,
    gateEligible: boundary.gateEligible,
  };
}

export function unavailableProviderEgressNetworkPolicy(
  request: Extract<ContainerNetworkPolicyRequest, { kind: "provider-egress" }>,
  boundary: ProviderEgressTaskSubprocessBoundary = providerEgressTaskSubprocessBoundary(
    undefined,
  ),
): ExecutionNetworkPolicy {
  return {
    kind: "provider-egress",
    provider: request.provider,
    enforcementMode: "unavailable",
    networkName: request.enforcement.networkName,
    proxyUrl: request.enforcement.proxyUrl,
    allowedProviderEndpoints: providerEgressEndpointsFor(request.provider),
    containerNetworkScope: "unavailable",
    taskSubprocessBoundary: boundary,
    gateEligible: false,
  };
}
