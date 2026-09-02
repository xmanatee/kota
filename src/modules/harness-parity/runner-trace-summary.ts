import type { HarnessCapabilitySnapshot } from "#core/agent-harness/index.js";
import { tail } from "./runner-files.js";
import type {
  HarnessParityArtifact,
  HarnessParityStageArtifact,
} from "./runner-types.js";

export function buildStagedTraceSummary(artifact: HarnessParityArtifact): string {
  const lines: string[] = [];
  lines.push(`# ${artifact.harnessName} — ${artifact.scenarioId}`);
  lines.push("");
  lines.push(`- model: ${artifact.model}`);
  lines.push(`- effort: ${artifact.effort}`);
  lines.push(`- stageMode: ${artifact.stageMode}`);
  lines.push(`- stages: ${artifact.stages.length}`);
  lines.push(`- startedAt: ${artifact.startedAt}`);
  lines.push(`- durationMs: ${artifact.durationMs}`);
  lines.push(`- turns: ${artifact.turns}`);
  lines.push(`- isError: ${artifact.isError}`);
  lines.push(`- tokenUsage: ${formatTokenUsage(artifact.usage)}`);
  lines.push(`- cost: ${formatCost(artifact.usage)}`);
  lines.push(
    `- verification: ${artifact.verification.passed ? "pass" : "fail"} (${artifact.stages.filter((stage) => stage.verification.passed).length}/${artifact.stages.length} stages passed)`,
  );
  lines.push(
    `- trajectoryDiagnostics: warnings=${artifact.trajectoryDiagnostics.warningCount}, artifact=${artifact.trajectoryDiagnostics.artifactPath}`,
  );
  if (artifact.contextRetrievalDiagnostics !== undefined) {
    lines.push(
      `- contextRetrievalDiagnostics: warnings=${artifact.contextRetrievalDiagnostics.warningCount}, missed=${artifact.contextRetrievalDiagnostics.missedTargetCount}, relevantBeforeEdit=${artifact.contextRetrievalDiagnostics.relevantRetrievalBeforeFirstEdit}, artifact=${artifact.contextRetrievalDiagnostics.artifactPath}`,
    );
  }
  lines.push(`- changedFiles (${artifact.changedFiles.length}):`);
  for (const path of artifact.changedFiles) lines.push(`  - ${path}`);
  lines.push("");
  lines.push("## Stages");
  lines.push("");
  for (const stage of artifact.stages) {
    lines.push(
      `- ${stage.stageId}: ${stage.verification.passed ? "pass" : "fail"} (exit ${stage.verification.exitStatus ?? "null"}${stage.verification.timedOut ? ", timeout" : ""}), turns=${stage.turns}, changedFiles=${stage.changedFiles.length}, diagnosticWarnings=${stage.trajectoryDiagnostics.warningCount}`,
    );
    lines.push(`  - artifacts: ${stage.artifactDir}`);
    lines.push(`  - diagnostics: ${stage.trajectoryDiagnostics.artifactPath}`);
    if (stage.contextRetrievalDiagnostics !== undefined) {
      lines.push(
        `  - contextRetrieval: warnings=${stage.contextRetrievalDiagnostics.warningCount}, missed=${stage.contextRetrievalDiagnostics.missedTargetCount}, artifact=${stage.contextRetrievalDiagnostics.artifactPath}`,
      );
    }
  }
  lines.push("");
  lines.push("## Capability boundary");
  lines.push("");
  renderCapabilityBoundary(lines, artifact.capability);
  return `${lines.join("\n")}\n`;
}

export function buildTraceSummary(
  artifact: HarnessParityArtifact | HarnessParityStageArtifact,
  runError: Error | null,
  streamedText: string,
): string {
  const lines: string[] = [];
  lines.push(`# ${artifact.harnessName} — ${artifact.scenarioId}`);
  lines.push("");
  lines.push(`- model: ${artifact.model}`);
  lines.push(`- effort: ${artifact.effort}`);
  lines.push(`- startedAt: ${artifact.startedAt}`);
  lines.push(`- durationMs: ${artifact.durationMs}`);
  lines.push(`- turns: ${artifact.turns}`);
  lines.push(`- isError: ${artifact.isError}`);
  if (artifact.subtype !== undefined) lines.push(`- subtype: ${artifact.subtype}`);
  lines.push(`- tokenUsage: ${formatTokenUsage(artifact.usage)}`);
  lines.push(`- cost: ${formatCost(artifact.usage)}`);
  lines.push(
    `- verification: ${artifact.verification.passed ? "pass" : "fail"} (exit ${artifact.verification.exitStatus ?? "null"}${artifact.verification.timedOut ? ", timeout" : ""})`,
  );
  lines.push(
    `- trajectoryDiagnostics: warnings=${artifact.trajectoryDiagnostics.warningCount}, artifact=${artifact.trajectoryDiagnostics.artifactPath}`,
  );
  if (artifact.contextRetrievalDiagnostics !== undefined) {
    lines.push(
      `- contextRetrievalDiagnostics: warnings=${artifact.contextRetrievalDiagnostics.warningCount}, missed=${artifact.contextRetrievalDiagnostics.missedTargetCount}, relevantBeforeEdit=${artifact.contextRetrievalDiagnostics.relevantRetrievalBeforeFirstEdit}, artifact=${artifact.contextRetrievalDiagnostics.artifactPath}`,
    );
  }
  lines.push(`- changedFiles (${artifact.changedFiles.length}):`);
  for (const path of artifact.changedFiles) lines.push(`  - ${path}`);
  if (artifact.previewArtifacts.length > 0) {
    lines.push(`- previewArtifacts (${artifact.previewArtifacts.length}):`);
    for (const preview of artifact.previewArtifacts) {
      if (preview.preserved) {
        lines.push(`  - ${preview.sourcePath}: ${preview.artifactPath}`);
      } else {
        lines.push(
          `  - ${preview.sourcePath}: ${preview.reason} (${preview.artifactPath})`,
        );
      }
    }
  }
  lines.push("");
  lines.push("## Capability boundary");
  lines.push("");
  renderCapabilityBoundary(lines, artifact.capability);
  if (runError) {
    lines.push("");
    lines.push("## Run error");
    lines.push("");
    lines.push("```");
    lines.push(runError.message);
    lines.push("```");
  }
  lines.push("");
  lines.push("## Streamed text (tail)");
  lines.push("");
  lines.push("```");
  lines.push(tail(streamedText, 8_000));
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

function formatTokenUsage(usage: HarnessParityArtifact["usage"]): string {
  if (usage.tokens.state === "unknown") return "unknown";
  return `${usage.tokens.state} (${usage.tokens.inputTokens} in, ${usage.tokens.outputTokens} out)`;
}

function formatCost(usage: HarnessParityArtifact["usage"]): string {
  if (usage.cost.state === "complete") return `$${usage.cost.usd}`;
  if (usage.cost.state === "partial") return `at least $${usage.cost.usd}`;
  if (usage.cost.state === "unavailable") {
    return `unavailable (${usage.cost.reason})`;
  }
  return "unknown";
}

function renderCapabilityBoundary(
  lines: string[],
  capability: HarnessCapabilitySnapshot,
): void {
  lines.push(`- toolControl: ${capability.toolControl}`);
  lines.push(
    `- nativeAbortQuarantine: ${capability.nativeAbortQuarantine ?? "none"}`,
  );
  lines.push(`- supportsMultiTurn: ${capability.supportsMultiTurn}`);
  lines.push(
    `- ownerQuestions: ${
      capability.askOwnerToolName === null
        ? "unsupported"
        : `supported (${capability.askOwnerToolName})`
    }`,
  );
  lines.push(
    `- emitsAgentMessageStream: ${capability.emitsAgentMessageStream}`,
  );
  lines.push(
    `- supportedHookKinds: ${capability.supportedHookKinds.join(", ") || "none"}`,
  );
  lines.push(
    `- unsupportedRunOptions (${capability.unsupportedRunOptions.length}):`,
  );
  if (capability.unsupportedRunOptions.length === 0) {
    lines.push("  - none");
  } else {
    for (const entry of capability.unsupportedRunOptions) {
      const runOption =
        entry.runOption !== undefined ? ` [${entry.runOption}]` : "";
      lines.push(`  - ${entry.option}${runOption}: ${entry.reason}`);
    }
  }
  if (capability.localReadiness === undefined) {
    lines.push("- localReadiness: not declared");
    return;
  }

  lines.push(
    `- localReadiness: ${capability.localReadiness.adapterKind}`,
  );
  lines.push(
    `  - runtime: ${capability.localReadiness.localRuntime.status} - ${capability.localReadiness.localRuntime.summary}`,
  );
  if (capability.localReadiness.localAuth !== undefined) {
    lines.push(
      `  - auth: ${capability.localReadiness.localAuth.status} - ${capability.localReadiness.localAuth.summary}`,
    );
  }
  if (capability.localReadiness.optionalRuntimes.length > 0) {
    lines.push("  - optionalRuntimes:");
    for (const runtime of capability.localReadiness.optionalRuntimes) {
      lines.push(`    - ${runtime.status} - ${runtime.summary}`);
    }
  }
}
