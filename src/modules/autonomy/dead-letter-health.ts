import type {
  DeadLetterFailureClass,
  DeadLetterItem,
} from "#core/daemon/dead-letter-queue.js";
import { classifyAgentRuntimeFailure } from "#core/workflow/steps/step-executor-retry.js";
import type {
  AutonomyHealthActionability,
  AutonomyHealthSeverity,
} from "./health-signal.js";

export type DeadLetterHealthCategory = {
  failureClass: DeadLetterFailureClass;
  category: "external-service/auth" | "local-code";
  actionability: AutonomyHealthActionability;
  labels: string[];
  severity: AutonomyHealthSeverity;
};

type DeadLetterFailureView = Pick<
  DeadLetterItem["failure"],
  "lastErrorClass" | "reason"
>;

function parseAgentFailureSubtype(reason: string): string | undefined {
  return /\(([^)]+)\):/.exec(reason)?.[1];
}

export function deadLetterHealthCategory(
  failure: DeadLetterFailureView,
): DeadLetterHealthCategory {
  const failureClass = classifyAgentRuntimeFailure({
    message: failure.reason,
    subtype: parseAgentFailureSubtype(failure.reason),
  })?.kind ?? failure.lastErrorClass;

  switch (failureClass) {
    case "auth":
    case "provider":
    case "rate_limit":
      return {
        failureClass,
        category: "external-service/auth",
        actionability: "external-service",
        labels: ["dead-letter", "external-service", failureClass],
        severity: "warning",
      };
    case "schema":
    case "validation":
    case "execution":
    case "runtime":
    case "output_contract":
    case "unknown":
      return {
        failureClass,
        category: "local-code",
        actionability: "local-code",
        labels: ["dead-letter", "local-code", failureClass],
        severity: "error",
      };
  }
}
