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
