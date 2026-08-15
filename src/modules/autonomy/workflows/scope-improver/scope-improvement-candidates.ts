import type {
  ScopeImprovementCandidate,
  ScopeImprovementInputs,
} from "./scope-improvement-types.js";

function formatFileList(files: readonly string[]): string {
  if (files.length <= 3) return files.join(", ");
  return `${files.slice(0, 3).join(", ")} and ${files.length - 3} more`;
}

function isNormalizedTaskFile(path: string): boolean {
  return /^data\/tasks\/(?:backlog|ready|doing|blocked|done|dropped)\/task-[^/]+\.md$/.test(
    path,
  );
}

function fileEvidenceIdsForPaths(
  inputs: ScopeImprovementInputs,
  paths: readonly string[],
): string[] {
  const wanted = new Set(paths);
  return inputs.evidence
    .filter((item) => item.kind === "file" && item.path && wanted.has(item.path))
    .map((item) => item.id);
}

export function missingGuidanceCandidate(
  inputs: ScopeImprovementInputs,
): ScopeImprovementCandidate {
  return {
    id: "missing-scope-guidance",
    signature: `${inputs.scope.scopeId}:missing-scope-guidance`,
    title: `Add scope guidance for ${inputs.scope.displayName}`,
    summary:
      "The scope has no AGENTS.md guidance, so improvement work lacks local constraints.",
    evidenceIds: ["policy:scope-improvement"],
    preferredAction: "owner-question",
  };
}

export function recentChangeCandidate(
  inputs: ScopeImprovementInputs,
): ScopeImprovementCandidate {
  const taskFiles = inputs.changedFiles.filter(isNormalizedTaskFile);
  const reviewableFiles = inputs.changedFiles.filter((path) => !isNormalizedTaskFile(path));
  if (reviewableFiles.length === 0) {
    return {
      id: "task-file-only-change-without-scope-gap",
      signature:
        `${inputs.scope.scopeId}:task-file-only-change-without-scope-gap:` +
        inputs.changedFiles.join("|"),
      title: `Skip task-file-only change evidence in ${inputs.scope.displayName}`,
      summary:
        `Changed task file(s) alone do not identify durable scope-improvement work: ` +
        formatFileList(taskFiles),
      evidenceIds: fileEvidenceIdsForPaths(inputs, inputs.changedFiles),
      preferredAction: "skip",
      skipReason:
        "task-file-only change evidence is queue churn, not a concrete scope gap",
    };
  }
  const fileList = formatFileList(reviewableFiles);
  return {
    id: "recent-file-change-without-scope-gap",
    signature:
      `${inputs.scope.scopeId}:recent-file-change-without-scope-gap:` +
      reviewableFiles.join("|"),
    title: `Skip recent file-change evidence in ${inputs.scope.displayName}`,
    summary:
      `Changed scoped file(s) alone do not identify durable scope-improvement work: ${fileList}.`,
    evidenceIds: fileEvidenceIdsForPaths(inputs, inputs.changedFiles),
    preferredAction: "skip",
    skipReason:
      "recent file-change evidence does not name a concrete scope gap without task, run, or owner context",
  };
}
