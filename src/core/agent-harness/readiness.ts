import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export type AgentHarnessAdapterKind =
  | "agent-sdk"
  | "native-cli"
  | "provider-sdk"
  | "model-client"
  | "ai-sdk"
  | "text-completion"
  | "unknown";

export type AgentHarnessRuntimeStatus = "ready" | "missing" | "error";
export type AgentHarnessAuthStatus = "ready" | "missing" | "error";

export type AgentHarnessRuntimeProbe =
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
  | "autonomyMode.supervised"
  | "persistSession"
  | "resumeSessionId"
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
      readonly status: "missing";
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
  readonly missingSummary?: string;
};

export type NativeCliAuthProbeSpec = {
  readonly binaryName: string;
  readonly statusArgs: readonly string[];
  readonly required: boolean;
  readonly readyPattern: RegExp;
  readonly missingPattern: RegExp;
  readonly readySummary: string;
  readonly missingSummary: string;
};

export type NodePackageRuntimeProbeSpec = {
  readonly packageName: string;
  readonly required: boolean;
};

const require = createRequire(import.meta.url);

function trimOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
}

function readPackageJsonVersion(packageJsonPath: string): PackageVersionResolution {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
      version?: string;
    };
    if (typeof parsed.version === "string" && parsed.version.trim()) {
      return { status: "ready", version: parsed.version.trim() };
    }
    return {
      status: "error",
      detail: `package.json at ${packageJsonPath} does not declare a version`,
    };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function resolvePackageJsonPath(packageName: string): string | null {
  try {
    return require.resolve(`${packageName}/package.json`);
  } catch {
    // Some packages hide package.json behind exports. Fall through and walk up
    // from the resolved entry point.
  }

  try {
    let current = dirname(require.resolve(packageName));
    while (current !== dirname(current)) {
      const candidate = join(current, "package.json");
      if (existsSync(candidate)) return candidate;
      current = dirname(current);
    }
  } catch {
    return null;
  }
  return null;
}

export const NODE_RUNTIME_PROBE_DEPS: AgentHarnessRuntimeProbeDeps = {
  resolveBinary(binaryName: string): BinaryResolution {
    const lookup = process.platform === "win32" ? "where" : "which";
    const result = spawnSync(lookup, [binaryName], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { status: "error", detail: result.error.message };
    }
    const output = trimOutput(result.stdout ?? "", result.stderr ?? "");
    if (result.status !== 0) {
      return {
        status: "missing",
        detail: output || `${binaryName} was not found on PATH`,
      };
    }
    const executablePath = output.split(/\r?\n/)[0]?.trim();
    if (!executablePath) {
      return {
        status: "error",
        detail: `${lookup} ${binaryName} succeeded without an executable path`,
      };
    }
    return { status: "ready", executablePath };
  },

  readCommandVersion(
    command: string,
    args: readonly string[],
  ): CommandVersionResolution {
    const result = spawnSync(command, [...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { status: "error", detail: result.error.message };
    }
    const output = trimOutput(result.stdout ?? "", result.stderr ?? "");
    if (result.status !== 0) {
      return {
        status: "error",
        detail:
          output ||
          `${command} ${args.join(" ")} exited with status ${result.status}`,
      };
    }
    const version = output.split(/\r?\n/)[0]?.trim() ?? "";
    if (!version) {
      return {
        status: "error",
        detail: `${command} ${args.join(" ")} did not print a version`,
      };
    }
    return { status: "ready", version };
  },

  readCommandOutput(
    command: string,
    args: readonly string[],
  ): CommandOutputResolution {
    const result = spawnSync(command, [...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) {
      return { status: "error", detail: result.error.message };
    }
    const output = trimOutput(result.stdout ?? "", result.stderr ?? "");
    if (result.status !== 0) {
      return {
        status: "error",
        detail:
          output ||
          `${command} ${args.join(" ")} exited with status ${result.status}`,
      };
    }
    return { status: "ready", output };
  },

  readPackageVersion(packageName: string): PackageVersionResolution {
    const packageJsonPath = resolvePackageJsonPath(packageName);
    if (!packageJsonPath) {
      return {
        status: "missing",
        detail: `${packageName} package.json could not be resolved`,
      };
    }
    return readPackageJsonVersion(packageJsonPath);
  },
};

export function probeNativeCliRuntime(
  spec: NativeCliRuntimeProbeSpec,
  deps: AgentHarnessRuntimeProbeDeps = NODE_RUNTIME_PROBE_DEPS,
): AgentHarnessRuntimeProbe {
  const command = `${spec.binaryName} ${spec.versionArgs.join(" ")}`.trim();
  const binary = deps.resolveBinary(spec.binaryName);
  if (binary.status === "missing") {
    return {
      kind: "native-cli",
      status: "missing",
      required: spec.required,
      command,
      binaryName: spec.binaryName,
      summary:
        spec.missingSummary ??
        `${spec.binaryName} executable not found on PATH`,
    };
  }
  if (binary.status === "error") {
    return {
      kind: "native-cli",
      status: "error",
      required: spec.required,
      command,
      binaryName: spec.binaryName,
      detail: binary.detail,
      summary: `${spec.binaryName} lookup failed: ${binary.detail}`,
    };
  }

  const version = deps.readCommandVersion(
    binary.executablePath,
    spec.versionArgs,
  );
  if (version.status === "error") {
    return {
      kind: "native-cli",
      status: "error",
      required: spec.required,
      command,
      binaryName: spec.binaryName,
      executablePath: binary.executablePath,
      detail: version.detail,
      summary: `${command} failed: ${version.detail}`,
    };
  }

  return {
    kind: "native-cli",
    status: "ready",
    required: spec.required,
    command,
    binaryName: spec.binaryName,
    executablePath: binary.executablePath,
    version: version.version,
    summary: `${version.version} at ${binary.executablePath}`,
  };
}

export function probeNativeCliAuth(
  spec: NativeCliAuthProbeSpec,
  deps: AgentHarnessRuntimeProbeDeps = NODE_RUNTIME_PROBE_DEPS,
): AgentHarnessAuthProbe {
  const command = `${spec.binaryName} ${spec.statusArgs.join(" ")}`.trim();
  const binary = deps.resolveBinary(spec.binaryName);
  if (binary.status === "missing") {
    return {
      kind: "harness-managed-login",
      status: "missing",
      required: spec.required,
      command,
      detail: binary.detail,
      summary: spec.missingSummary,
    };
  }
  if (binary.status === "error") {
    return {
      kind: "harness-managed-login",
      status: "error",
      required: spec.required,
      command,
      detail: binary.detail,
      summary: `${spec.binaryName} auth probe lookup failed: ${binary.detail}`,
    };
  }

  const status = deps.readCommandOutput(binary.executablePath, spec.statusArgs);
  if (status.status === "error") {
    if (spec.missingPattern.test(status.detail)) {
      return {
        kind: "harness-managed-login",
        status: "missing",
        required: spec.required,
        command,
        detail: status.detail,
        summary: spec.missingSummary,
      };
    }
    return {
      kind: "harness-managed-login",
      status: "error",
      required: spec.required,
      command,
      detail: status.detail,
      summary: `${command} failed: ${status.detail}`,
    };
  }

  if (spec.readyPattern.test(status.output)) {
    return {
      kind: "harness-managed-login",
      status: "ready",
      required: spec.required,
      command,
      detail: status.output,
      summary: spec.readySummary,
    };
  }
  if (spec.missingPattern.test(status.output)) {
    return {
      kind: "harness-managed-login",
      status: "missing",
      required: spec.required,
      command,
      detail: status.output,
      summary: spec.missingSummary,
    };
  }
  return {
    kind: "harness-managed-login",
    status: "error",
    required: spec.required,
    command,
    detail: status.output,
    summary: `${command} returned an unrecognized auth status`,
  };
}

export function probeNodePackageRuntime(
  spec: NodePackageRuntimeProbeSpec,
  deps: AgentHarnessRuntimeProbeDeps = NODE_RUNTIME_PROBE_DEPS,
): AgentHarnessRuntimeProbe {
  const result = deps.readPackageVersion(spec.packageName);
  if (result.status === "ready") {
    return {
      kind: "node-package",
      status: "ready",
      required: spec.required,
      packageName: spec.packageName,
      version: result.version,
      summary: `${spec.packageName}@${result.version}`,
    };
  }
  if (result.status === "missing") {
    return {
      kind: "node-package",
      status: "missing",
      required: spec.required,
      packageName: spec.packageName,
      summary: `${spec.packageName} is not installed`,
    };
  }
  return {
    kind: "node-package",
    status: "error",
    required: spec.required,
    packageName: spec.packageName,
    detail: result.detail,
    summary: `${spec.packageName} version probe failed: ${result.detail}`,
  };
}
