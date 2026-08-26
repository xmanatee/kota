import { parseAddedLinesByFile, readWorkflowDiff } from "./workflow-diff.js";

export type RepoHygieneFinding = {
  file: string;
  kind:
    | "empty-catch"
    | "unexplained-suppression"
    | "commented-out-code";
  line: string;
  message: string;
};

const EMPTY_CATCH_RE = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const SUPPRESSION_RE = /(?:@ts-ignore|@ts-expect-error|eslint-disable(?:-next-line)?|biome-ignore)\b/;
const SUPPRESSION_WITH_REASON_RE =
  /\b(?:@ts-ignore|@ts-expect-error|eslint-disable(?:-next-line)?|biome-ignore)\b.*:\s*\S.{11,}/;
const COMMENTED_OUT_CODE_RE =
  /^\s*\/\/\s*(?:export\s+|import\s+|const\s+|let\s+|var\s+|function\s+|class\s+|if\s*\(|for\s*\(|while\s*\(|return\b|await\b)/;
export function detectRepoHygieneInDiff(diff: string): RepoHygieneFinding[] {
  const findings: RepoHygieneFinding[] = [];
  for (const fileDiff of parseAddedLinesByFile(diff)) {
    for (const line of fileDiff.addedLines) {
      if (/^\s*\+/.test(line)) continue;
      if (hasEmptyCatch(line)) {
        findings.push({
          file: fileDiff.file,
          kind: "empty-catch",
          line,
          message: "Empty catch blocks hide failures. Handle the error, report it, or use a non-throwing API.",
        });
      }
      if (SUPPRESSION_RE.test(line) && !SUPPRESSION_WITH_REASON_RE.test(line)) {
        findings.push({
          file: fileDiff.file,
          kind: "unexplained-suppression",
          line,
          message: "Lint/type suppressions need a narrow reason after a colon.",
        });
      }
      if (SUPPRESSION_RE.test(line)) continue;
      if (COMMENTED_OUT_CODE_RE.test(line)) {
        findings.push({
          file: fileDiff.file,
          kind: "commented-out-code",
          line,
          message: "Commented-out code belongs in git history, not the current source.",
        });
      }
    }
  }
  return findings;
}

function hasEmptyCatch(line: string): boolean {
  const match = line.match(EMPTY_CATCH_RE);
  if (!match || match.index === undefined) return false;
  const beforeCatch = line.slice(0, match.index);
  return !/["'`]/.test(beforeCatch);
}

export function formatRepoHygieneFindings(findings: readonly RepoHygieneFinding[]): string {
  return findings
    .map((finding) => {
      const line = finding.line.length > 160 ? `${finding.line.slice(0, 157)}...` : finding.line;
      return `  ${finding.file} [${finding.kind}]: ${finding.message}\n    + ${line}`;
    })
    .join("\n\n");
}

export function checkRepoHygiene(workspaceRoot: string): string {
  const diff = readWorkflowDiff(workspaceRoot, ["."]);
  if (!diff.trim()) return "OK: no staged changes";
  const findings = detectRepoHygieneInDiff(diff);
  if (findings.length > 0) {
    throw new Error(
      [
        "Repo hygiene check rejected staged changes with mechanical hygiene errors.",
        formatRepoHygieneFindings(findings),
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }
  return "OK: staged changes show no repo hygiene issues";
}
