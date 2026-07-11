import type {
  AgentHarnessAuthProbe,
  AgentHarnessRuntimeProbe,
  AgentHarnessRuntimeProbeDeps,
  NativeCliAuthProbeSpec,
  NativeCliRuntimeProbeSpec,
  NodePackageRuntimeProbeSpec,
  NodeRuntimeProbeSpec,
} from "./readiness-types.js";

export { NODE_RUNTIME_PROBE_DEPS } from "./readiness-node-deps.js";

import { NODE_RUNTIME_PROBE_DEPS } from "./readiness-node-deps.js";

function parseNumericVersion(value: string): readonly [number, number, number] | null {
  const match = value.match(/(?:^|\D)(\d+)\.(\d+)\.(\d+)(?:\D|$)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(
  left: readonly [number, number, number],
  right: readonly [number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

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

  if (spec.minimumVersion !== undefined) {
    const installed = parseNumericVersion(version.version);
    const minimum = parseNumericVersion(spec.minimumVersion);
    if (installed === null || minimum === null) {
      return {
        kind: "native-cli",
        status: "error",
        required: spec.required,
        command,
        binaryName: spec.binaryName,
        executablePath: binary.executablePath,
        version: version.version,
        detail: `Could not compare installed version "${version.version}" with required version "${spec.minimumVersion}".`,
        summary: `${spec.binaryName} version compatibility could not be determined`,
      };
    }
    if (compareVersions(installed, minimum) < 0) {
      return {
        kind: "native-cli",
        status: "error",
        required: spec.required,
        command,
        binaryName: spec.binaryName,
        executablePath: binary.executablePath,
        version: version.version,
        detail: `${spec.binaryName} ${spec.minimumVersion} or newer is the supported KOTA runtime.`,
        summary: `${spec.binaryName} ${spec.minimumVersion} or newer is supported; found ${version.version}`,
      };
    }
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

function matchAuthPattern(
  pattern: RegExp | undefined,
  value: string,
): RegExpExecArray | null {
  if (pattern === undefined) return null;
  pattern.lastIndex = 0;
  return pattern.exec(value);
}

function namedMatch(match: RegExpExecArray, name: string): string | undefined {
  const value = match.groups?.[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function redactAgentHarnessAuthDetail(value: string): string {
  return value.replace(
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
    "[redacted-email]",
  );
}

function nativeCliRenewalSummary(spec: NativeCliAuthProbeSpec): string {
  return spec.renewalSummary ?? spec.missingSummary;
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
    const staleMatch = matchAuthPattern(spec.stalePattern, status.detail);
    if (staleMatch) {
      const expiredAt =
        namedMatch(staleMatch, "expiredAt") ??
        namedMatch(staleMatch, "expiresAt");
      return {
        kind: "harness-managed-login",
        status: "stale",
        required: spec.required,
        command,
        detail: redactAgentHarnessAuthDetail(status.detail),
        summary: spec.staleSummary ?? `${command} login is stale`,
        ...(expiredAt !== undefined ? { expiredAt } : {}),
        renewalSummary: nativeCliRenewalSummary(spec),
      };
    }
    if (matchAuthPattern(spec.missingPattern, status.detail)) {
      return {
        kind: "harness-managed-login",
        status: "missing",
        required: spec.required,
        command,
        detail: redactAgentHarnessAuthDetail(status.detail),
        summary: spec.missingSummary,
      };
    }
    const detail = redactAgentHarnessAuthDetail(status.detail);
    return {
      kind: "harness-managed-login",
      status: "error",
      required: spec.required,
      command,
      detail,
      summary: `${command} failed: ${detail}`,
    };
  }

  const staleMatch = matchAuthPattern(spec.stalePattern, status.output);
  if (staleMatch) {
    const expiredAt =
      namedMatch(staleMatch, "expiredAt") ??
      namedMatch(staleMatch, "expiresAt");
    return {
      kind: "harness-managed-login",
      status: "stale",
      required: spec.required,
      command,
      detail: redactAgentHarnessAuthDetail(status.output),
      summary: spec.staleSummary ?? `${command} login is stale`,
      ...(expiredAt !== undefined ? { expiredAt } : {}),
      renewalSummary: nativeCliRenewalSummary(spec),
    };
  }
  const expiringMatch = matchAuthPattern(spec.expiringPattern, status.output);
  if (expiringMatch) {
    const expiresAt = namedMatch(expiringMatch, "expiresAt");
    return {
      kind: "harness-managed-login",
      status: "expiring",
      required: spec.required,
      command,
      detail: redactAgentHarnessAuthDetail(status.output),
      summary: spec.expiringSummary ?? `${command} login expires soon`,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
      renewalSummary: nativeCliRenewalSummary(spec),
    };
  }
  if (matchAuthPattern(spec.readyPattern, status.output)) {
    return {
      kind: "harness-managed-login",
      status: "ready",
      required: spec.required,
      command,
      detail: redactAgentHarnessAuthDetail(status.output),
      summary: spec.readySummary,
    };
  }
  if (matchAuthPattern(spec.missingPattern, status.output)) {
    return {
      kind: "harness-managed-login",
      status: "missing",
      required: spec.required,
      command,
      detail: redactAgentHarnessAuthDetail(status.output),
      summary: spec.missingSummary,
    };
  }
  return {
    kind: "harness-managed-login",
    status: "error",
    required: spec.required,
    command,
    detail: redactAgentHarnessAuthDetail(status.output),
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

export function probeCurrentNodeRuntime(
  spec: NodeRuntimeProbeSpec = { required: true },
): AgentHarnessRuntimeProbe {
  return {
    kind: "node-runtime",
    status: "ready",
    required: spec.required,
    version: process.versions.node,
    summary: `Node.js ${process.versions.node}`,
  };
}
