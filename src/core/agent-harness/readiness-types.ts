export type AgentHarnessAdapterKind =
  | "agent-sdk"
  | "native-cli"
  | "provider-sdk"
  | "model-client"
  | "ai-sdk"
  | "text-completion"
  | "unknown";

export type AgentHarnessRuntimeStatus = "ready" | "missing" | "error";
export type AgentHarnessAuthStatus =
  | "ready"
  | "expiring"
  | "stale"
  | "missing"
  | "unverifiable"
  | "error";

export type AgentHarnessRuntimeProbe =
  | {
      readonly kind: "node-runtime";
      readonly status: "ready";
      readonly required: boolean;
      readonly version: string;
      readonly summary: string;
    }
  | {
      readonly kind: "native-cli";
      readonly status: "ready";
      readonly required: boolean;
      readonly command: string;
      readonly binaryName: string;
      readonly executablePath: string;
      readonly version: string;
      readonly summary: string;
    }
  | {
      readonly kind: "native-cli";
      readonly status: "missing";
      readonly required: boolean;
      readonly command: string;
      readonly binaryName: string;
      readonly summary: string;
    }
  | {
      readonly kind: "native-cli";
      readonly status: "error";
      readonly required: boolean;
      readonly command: string;
      readonly binaryName: string;
      readonly executablePath?: string;
      readonly version?: string;
      readonly detail: string;
      readonly summary: string;
    }
  | {
      readonly kind: "node-package";
      readonly status: "ready";
      readonly required: boolean;
      readonly packageName: string;
      readonly version: string;
      readonly summary: string;
    }
  | {
      readonly kind: "node-package";
      readonly status: "missing";
      readonly required: boolean;
      readonly packageName: string;
      readonly summary: string;
    }
  | {
      readonly kind: "node-package";
      readonly status: "error";
      readonly required: boolean;
      readonly packageName: string;
      readonly detail: string;
      readonly summary: string;
    };

export type AgentHarnessUnsupportedOption = {
  readonly runOption?: AgentHarnessUnsupportedRunOption;
  readonly option: string;
  readonly reason: string;
};

export type AgentHarnessUnsupportedRunOption =
  | "mcpServers"
  | "allowedTools"
  | "disallowedTools"
  | "canUseTool"
  | "askOwner"
  | "autonomyMode.passive"
  | "autonomyMode.supervised"
  | "persistSession"
  | "resumeSessionId"
  | "env"
  | "scopePolicy"
  | "harnessOverrides"
  | "enableFileCheckpointing"
  | "thinking"
  | "onMessage";

export type AgentHarnessAuthProbe =
  | {
      readonly kind: "harness-managed-login";
      readonly status: "ready";
      readonly required: boolean;
      readonly command: string;
      readonly detail: string;
      readonly summary: string;
    }
  | {
      readonly kind: "harness-managed-login";
      readonly status: "expiring";
      readonly required: boolean;
      readonly command: string;
      readonly detail: string;
      readonly summary: string;
      readonly expiresAt?: string;
      readonly renewalSummary: string;
    }
  | {
      readonly kind: "harness-managed-login";
      readonly status: "stale";
      readonly required: boolean;
      readonly command: string;
      readonly detail: string;
      readonly summary: string;
      readonly expiredAt?: string;
      readonly renewalSummary: string;
    }
  | {
      readonly kind: "harness-managed-login";
      readonly status: "missing";
      readonly required: boolean;
      readonly command: string;
      readonly detail: string;
      readonly summary: string;
    }
  | {
      readonly kind: "harness-managed-login";
      readonly status: "unverifiable";
      readonly required: boolean;
      readonly command: string;
      readonly detail: string;
      readonly summary: string;
    }
  | {
      readonly kind: "harness-managed-login";
      readonly status: "error";
      readonly required: boolean;
      readonly command: string;
      readonly detail: string;
      readonly summary: string;
    };

export type AgentHarnessReadiness = {
  readonly adapterKind: AgentHarnessAdapterKind;
  readonly localRuntime: AgentHarnessRuntimeProbe;
  readonly localAuth?: AgentHarnessAuthProbe;
  readonly optionalRuntimes: readonly AgentHarnessRuntimeProbe[];
  readonly unsupportedOptions: readonly AgentHarnessUnsupportedOption[];
};

export type AgentHarnessReadinessProbe = () => AgentHarnessReadiness;

export type BinaryResolution =
  | { readonly status: "ready"; readonly executablePath: string }
  | { readonly status: "missing"; readonly detail: string }
  | { readonly status: "error"; readonly detail: string };

export type CommandVersionResolution =
  | { readonly status: "ready"; readonly version: string }
  | { readonly status: "error"; readonly detail: string };

export type CommandOutputResolution =
  | { readonly status: "ready"; readonly output: string }
  | { readonly status: "error"; readonly detail: string };

export type PackageVersionResolution =
  | { readonly status: "ready"; readonly version: string }
  | { readonly status: "missing"; readonly detail: string }
  | { readonly status: "error"; readonly detail: string };

export type AgentHarnessRuntimeProbeDeps = {
  readonly resolveBinary: (binaryName: string) => BinaryResolution;
  readonly readCommandVersion: (
    command: string,
    args: readonly string[],
  ) => CommandVersionResolution;
  readonly readCommandOutput: (
    command: string,
    args: readonly string[],
  ) => CommandOutputResolution;
  readonly readPackageVersion: (
    packageName: string,
  ) => PackageVersionResolution;
};

export type NativeCliRuntimeProbeSpec = {
  readonly binaryName: string;
  readonly versionArgs: readonly string[];
  readonly required: boolean;
  readonly minimumVersion?: string;
  readonly missingSummary?: string;
};

export type NativeCliAuthProbeSpec = {
  readonly binaryName: string;
  readonly statusArgs: readonly string[];
  readonly required: boolean;
  readonly readyPattern: RegExp;
  readonly expiringPattern?: RegExp;
  readonly stalePattern?: RegExp;
  readonly missingPattern: RegExp;
  readonly readySummary: string;
  readonly expiringSummary?: string;
  readonly staleSummary?: string;
  readonly missingSummary: string;
  readonly renewalSummary?: string;
};

export type NodePackageRuntimeProbeSpec = {
  readonly packageName: string;
  readonly required: boolean;
};

export type NodeRuntimeProbeSpec = {
  readonly required: boolean;
};
