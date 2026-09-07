import {
  classifyModuleOperationFailure,
  type ModuleOperationFailureIdentity,
} from "#core/modules/module-operation-health.js";
import { stableToken } from "./autonomy-issue-source-shared.js";
import type { AutonomyHealthSignalInput } from "./health-signal.js";

export type ModuleOperationHealthPattern = Pick<
  AutonomyHealthSignalInput,
  "source" | "severity" | "actionability" | "labels" | "dedupeKey" | "summary"
>;

export function moduleOperationLabel(operation: string): string {
  return `operation/${stableToken(operation)}`;
}

export function moduleOperationHealthPattern(args: {
  module: string;
  operation: string;
  identity: ModuleOperationFailureIdentity;
}): ModuleOperationHealthPattern {
  const module = stableToken(args.module);
  const labels = ["module-failure", module, moduleOperationLabel(args.operation)];
  switch (args.identity.failureKind) {
    case "duplicate-consumer":
      return {
        source: { kind: "module-log", id: module, module },
        severity: "error",
        actionability: "owner-action",
        labels: [
          ...labels,
          "duplicate-consumer",
          "external-service",
          "operator-action",
        ],
        dedupeKey: `module:${module}:${args.identity.causeKey}`,
        summary: `${args.module} operation ${args.operation} reports a duplicate consumer.`,
      };
    case "auth":
      return {
        source: { kind: "module-log", id: module, module },
        severity: "error",
        actionability: "external-service",
        labels: [...labels, "auth", "external-service"],
        dedupeKey: `module:${module}:${args.identity.causeKey}`,
        summary: `${args.module} operation ${args.operation} reports an auth/setup failure.`,
      };
    case "provider":
      return {
        source: { kind: "module-log", id: module, module },
        severity: "warning",
        actionability: "external-service",
        labels: [...labels, "external-service", "provider"],
        dedupeKey: `module:${module}:${args.identity.causeKey}`,
        summary: `${args.module} operation ${args.operation} reports a provider or network failure.`,
      };
    case "cost-risk":
      return {
        source: { kind: "module-log", id: module, module },
        severity: "critical",
        actionability: "informational",
        labels: [...labels, "cost-risk", "runtime"],
        dedupeKey: `module:${module}:${args.identity.causeKey}`,
        summary: `${args.module} operation ${args.operation} reports a runtime cost risk.`,
      };
    case "local-code":
      return {
        source: { kind: "module-log", id: module, module },
        severity: "error",
        actionability: "local-code",
        labels: [...labels, "local-code", "runtime"],
        dedupeKey: `module:${module}:${args.identity.causeKey}`,
        summary: `${args.module} operation ${args.operation} reports a local runtime error.`,
      };
    case "unknown":
      return {
        source: { kind: "module-log", id: module, module },
        severity: "error",
        actionability: "informational",
        labels: [...labels, "unclassified", "runtime"],
        dedupeKey: `module:${module}:${args.identity.causeKey}`,
        summary: `${args.module} operation ${args.operation} reports an unclassified failure.`,
      };
  }
}

export function classifyModuleOperationHealth(args: {
  module: string;
  operation: string;
  message: string;
}): ModuleOperationHealthPattern {
  return moduleOperationHealthPattern({
    module: args.module,
    operation: args.operation,
    identity: classifyModuleOperationFailure(args),
  });
}
