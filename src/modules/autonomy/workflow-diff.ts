import {
  type BoundedWorkspaceChangeOutput,
  readWorkspaceChangeEvidence,
  readWorkspaceChanges,
  readWorkspaceDiffStat,
  readWorkspaceUnifiedDiff,
  WorkspaceChangeOutputLimitError,
} from "#core/workflow/workspace-change-evidence.js";

const GIT_DIFF_MAX_BUFFER = 50 * 1024 * 1024;
const REVIEW_DIFF_BYTE_LIMIT = 80_000;

export type FileDiff = {
  file: string;
  addedLines: string[];
  deletedLines: string[];
};

export function parseAddedLinesByFile(diff: string): FileDiff[] {
  const result: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const rawLine of diff.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/diff --git a\/(.+?) b\/(.+)$/);
      current = { file: match ? match[2] : "", addedLines: [], deletedLines: [] };
      result.push(current);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("+++") || rawLine.startsWith("---") || rawLine.startsWith("@@")) {
      continue;
    }
    if (rawLine.startsWith("+") && !rawLine.startsWith("++")) {
      current.addedLines.push(rawLine.slice(1));
    } else if (rawLine.startsWith("-") && !rawLine.startsWith("--")) {
      current.deletedLines.push(rawLine.slice(1));
    }
  }
  return result;
}

export function readWorkflowDiff(
  workspaceRoot: string,
  pathspecs: readonly string[],
  unifiedLines = 0,
): string {
  const diff = readWorkspaceUnifiedDiff(workspaceRoot, {
    pathspecs,
    unifiedLines,
    limits: { diffBytes: GIT_DIFF_MAX_BUFFER },
  });
  if (diff.truncated) {
    throw new WorkspaceChangeOutputLimitError("diff", diff.limitBytes);
  }
  return diff.text;
}

export function getWorkflowChangedFiles(workspaceRoot: string): string {
  return readWorkspaceChanges(workspaceRoot).map((change) => change.path).join("\n");
}

function formattedBoundedOutput(
  output: BoundedWorkspaceChangeOutput,
  label: string,
): string {
  if (!output.truncated) return output.text;
  return `${output.text}\n\n[... ${label} truncated at ${output.limitBytes / 1000}k bytes ...]`;
}

export function getWorkflowDiffStat(workspaceRoot: string): string {
  return formattedBoundedOutput(
    readWorkspaceDiffStat(workspaceRoot),
    "diff stat",
  );
}

export function getWorkflowDiffContent(workspaceRoot: string): string {
  return formattedBoundedOutput(
    readWorkspaceUnifiedDiff(workspaceRoot, {
      limits: { diffBytes: REVIEW_DIFF_BYTE_LIMIT },
    }),
    "diff",
  );
}

export function getWorkflowChangeEvidence(workspaceRoot: string): {
  changedFiles: string;
  diffStat: string;
  diffContent: string;
} {
  const evidence = readWorkspaceChangeEvidence(workspaceRoot, {
    limits: { diffBytes: REVIEW_DIFF_BYTE_LIMIT },
  });
  return {
    changedFiles: evidence.changes.map((change) => change.path).join("\n"),
    diffStat: formattedBoundedOutput(evidence.stat, "diff stat"),
    diffContent: formattedBoundedOutput(evidence.diff, "diff"),
  };
}
