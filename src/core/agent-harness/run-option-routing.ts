import type {
  AgentHarnessUnsupportedOption,
  AgentHarnessUnsupportedRunOption,
} from "./readiness.js";
import type { AgentHarness, AgentHarnessRunOptions } from "./types.js";

export function assertAdapterCanHostRequestedCapabilities(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
): void {
  if (
    harness.toolControl === "native" &&
    options.scopePolicyAuthority !== undefined
  ) {
    throw new Error(
      `Agent harness "${harness.name}" cannot receive KOTA's live scope-policy authority. ` +
        "Route only the resolved policy snapshot into native preflight.",
    );
  }
  const unsupported = requestedUnsupportedOptions(harness, options);
  if (unsupported.length > 0) {
    const labels = unsupported.map((entry) => entry.option).join(", ");
    const reasons = unsupported.map((entry) => `${entry.option}: ${entry.reason}`).join("; ");
    throw new Error(
      `Agent harness "${harness.name}" cannot honor requested run option(s): ${labels}. ` +
        `${reasons}`,
    );
  }
  if (options.askOwner && harness.askOwnerToolName === null) {
    throw new Error(
      `Agent harness "${harness.name}" cannot host the owner-questions surface (askOwnerToolName is null). ` +
        "Drop askOwner or run a harness that declares support — never run owner-questions silently disabled.",
    );
  }
}

function requestedUnsupportedOptions(
  harness: AgentHarness,
  options: AgentHarnessRunOptions,
): AgentHarnessUnsupportedOption[] {
  return (harness.unsupportedRunOptions ?? []).filter((entry) =>
    entry.runOption !== undefined && isRunOptionRequested(entry.runOption, options)
  );
}

function isRunOptionRequested(
  option: AgentHarnessUnsupportedRunOption,
  options: AgentHarnessRunOptions,
): boolean {
  if (option === "mcpServers") {
    return options.mcpServers !== undefined && Object.keys(options.mcpServers).length > 0;
  }
  if (option === "allowedTools") {
    return options.allowedTools !== undefined && options.allowedTools.length > 0;
  }
  if (option === "disallowedTools") {
    return options.disallowedTools !== undefined && options.disallowedTools.length > 0;
  }
  if (option === "canUseTool") return options.canUseTool !== undefined;
  if (option === "askOwner") return options.askOwner !== undefined;
  if (option === "autonomyMode.supervised") return options.autonomyMode === "supervised";
  if (option === "persistSession") return options.persistSession === true;
  if (option === "resumeSessionId") return options.resumeSessionId !== undefined;
  if (option === "env") {
    return options.env !== undefined && Object.keys(options.env).length > 0;
  }
  if (option === "scopePolicy") {
    return options.scopePolicy !== undefined || options.getScopePolicySnapshot !== undefined;
  }
  if (option === "harnessOverrides") return options.harnessOverrides !== undefined;
  if (option === "enableFileCheckpointing") return options.enableFileCheckpointing === true;
  if (option === "thinking") {
    return options.thinkingEnabled === true || options.thinkingBudget !== undefined;
  }
  return options.onMessage !== undefined;
}

export function shouldRouteKotaToolControl(harness: AgentHarness): boolean {
  return harness.toolControl === "kota";
}

export function routeKotaToolControlOptions(
  harness: AgentHarness,
  options: {
    allowedTools?: string[];
    disallowedTools?: string[];
    canUseTool?: AgentHarnessRunOptions["canUseTool"];
    scopePolicy?: AgentHarnessRunOptions["scopePolicy"];
    scopePolicyAuthority?: AgentHarnessRunOptions["scopePolicyAuthority"];
    getScopePolicySnapshot?: AgentHarnessRunOptions["getScopePolicySnapshot"];
  },
): {
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: AgentHarnessRunOptions["canUseTool"];
  scopePolicy?: AgentHarnessRunOptions["scopePolicy"];
  scopePolicyAuthority?: AgentHarnessRunOptions["scopePolicyAuthority"];
  getScopePolicySnapshot?: AgentHarnessRunOptions["getScopePolicySnapshot"];
} {
  if (!shouldRouteKotaToolControl(harness)) {
    return {
      ...(options.scopePolicy !== undefined
        ? { scopePolicy: options.scopePolicy }
        : {}),
      ...(options.getScopePolicySnapshot !== undefined
        ? { getScopePolicySnapshot: options.getScopePolicySnapshot }
        : {}),
    };
  }
  return options;
}
