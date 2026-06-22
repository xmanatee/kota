import type {
  WorkflowSimulationAvailability,
  WorkflowSimulationInputResult,
  WorkflowSimulationResult,
} from "./types.js";

function retainedString(
  availability: WorkflowSimulationAvailability,
  key: string,
): string | null {
  const value = availability.retained[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatAvailability(availability: WorkflowSimulationAvailability): string[] {
  const scopeId = retainedString(availability, "scopeId");
  const state = retainedString(availability, "state");
  const receivedAt = retainedString(availability, "receivedAt");
  const startedAt = retainedString(availability, "startedAt");
  const timestamp = receivedAt ?? startedAt ?? availability.prunedAt;
  const provenance = availability.provenance.workflowName
    ? ` workflow=${availability.provenance.workflowName}` +
      `${availability.provenance.runId ? ` run=${availability.provenance.runId}` : ""}`
    : "";
  return [
    `Availability: ${availability.kind} ${availability.reasonCode}`,
    `  - artifact=${availability.artifactType}:${availability.id}` +
      `${scopeId ? ` scope=${scopeId}` : ""}` +
      `${state ? ` state=${state}` : ""}` +
      ` timestamp=${timestamp} prunedAt=${availability.prunedAt}${provenance}`,
  ];
}

function formatInput(input: WorkflowSimulationInputResult): string[] {
  const lines: string[] = [];
  const id = input.eventId ? ` (${input.eventId})` : "";
  lines.push(`Input: ${input.event}${id}`);
  lines.push(`Outcome: ${input.outcome}`);
  if (input.availability) {
    lines.push(...formatAvailability(input.availability));
  }
  if (input.source.kind !== "synthetic") {
    const label = input.source.journalId ?? input.source.label;
    lines.push(label ? `Source: ${input.source.kind} ${label}` : `Source: ${input.source.kind}`);
  }

  lines.push("Matches:");
  if (input.matches.length === 0) {
    lines.push("  (none)");
  } else {
    for (const match of input.matches) {
      lines.push(`  - ${match.workflow} trigger#${match.triggerIndex} ${match.triggerEvent}`);
    }
  }

  if (input.effects.length > 0) {
    lines.push("Effects:");
    for (const effect of input.effects) {
      const status = effect.blocked ? "blocked" : "preview";
      const reason = effect.reason ? ` - ${effect.reason}` : "";
      lines.push(
        `  - ${effect.workflow}: ${effect.effectId} ${status} risk=${effect.risk}${reason}`,
      );
    }
  }

  if (input.dryRuns.length > 0) {
    lines.push("Dry Run:");
    for (const dryRun of input.dryRuns) {
      const status = dryRun.pass ? "pass" : "fail";
      lines.push(`  - ${dryRun.workflow}: ${status}, ${dryRun.steps.length} step(s)`);
      for (const diagnostic of dryRun.diagnostics) {
        const step = diagnostic.stepId ? ` ${diagnostic.stepId}` : "";
        lines.push(`    ${diagnostic.level}${step}: ${diagnostic.message}`);
      }
    }
  }

  lines.push("Reasons:");
  if (input.reasons.length === 0) {
    lines.push("  (none)");
  } else {
    for (const reason of input.reasons) {
      const workflow = reason.workflow ? ` [${reason.workflow}]` : "";
      lines.push(`  - ${reason.code}${workflow}: ${reason.message}`);
    }
  }
  return lines;
}

export function formatWorkflowSimulationResult(
  result: WorkflowSimulationResult,
): string {
  const lines: string[] = [];
  lines.push("Automation Simulation");
  lines.push("=====================");
  lines.push(`Inputs: ${result.summary.total}`);
  lines.push(
    [
      `ignore=${result.summary["would-ignore"]}`,
      `batch=${result.summary["would-batch"]}`,
      `queue=${result.summary["would-queue"]}`,
      `block=${result.summary["would-block"]}`,
      `ask-owner=${result.summary["would-ask-owner"]}`,
      `dlq=${result.summary["would-dlq"]}`,
      `effect=${result.summary["would-perform-effect"]}`,
      `noop=${result.summary["would-noop"]}`,
      `unknown=${result.summary.unknown}`,
    ].join(" "),
  );
  for (const input of result.inputs) {
    lines.push("");
    lines.push(...formatInput(input));
  }
  return lines.join("\n");
}
