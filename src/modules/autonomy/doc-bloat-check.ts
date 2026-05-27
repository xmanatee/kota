import { execFileSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

const DOC_PATH_RE = /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md)$/;
const DOCS_DIR_RE = /^docs\/.+\.md$/;

const TREE_DRAWING_RE = /[├└│]/;
const MIGRATION_PHRASE_RE = new RegExp(
  [
    String.raw`\bpreviously\s+(?:called|named|known\s+as|located|in)\b`,
    String.raw`\bwas\s+(?:renamed|moved|removed|added|introduced|replaced)\b`,
    String.raw`\bdeprecated\s+(?:in|since|as\s+of)\b`,
    String.raw`\bmigration\s+notes?\b`,
    String.raw`\bsince\s+v(?:ersion)?\s*\d`,
    String.raw`\bas\s+of\s+\d{4}-\d{2}-\d{2}\b`,
    String.raw`\blast\s+updated\s*[:=]?\s*\d`,
    String.raw`\bchangelog\b`,
  ].join("|"),
  "i",
);

const FILE_PATH_BULLET_RE =
  /^\s*[-*]\s+`?[A-Za-z0-9_./@-]*\/[A-Za-z0-9_./@-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yaml|yml|sh|swift|py|rs|go|java|kt)`?(?:\b|$)/;

const INVENTORY_BUDGET = 5;

export type DocBloatFinding = {
  file: string;
  kind: "tree-drawing" | "migration-phrase" | "file-inventory";
  detail: string;
  examples: string[];
};

type FileDiff = {
  file: string;
  addedLines: string[];
};

export function parseAddedLinesByFile(diff: string): FileDiff[] {
  const result: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const rawLine of diff.split("\n")) {
    if (rawLine.startsWith("diff --git ")) {
      const match = rawLine.match(/diff --git a\/(.+?) b\/(.+)$/);
      const file = match ? match[2] : "";
      current = { file, addedLines: [] };
      result.push(current);
      continue;
    }
    if (!current) continue;
    if (rawLine.startsWith("+++") || rawLine.startsWith("---") || rawLine.startsWith("@@")) {
      continue;
    }
    if (rawLine.startsWith("+") && !rawLine.startsWith("++")) {
      current.addedLines.push(rawLine.slice(1));
    }
  }
  return result;
}

function isDocFile(file: string): boolean {
  return DOC_PATH_RE.test(file) || DOCS_DIR_RE.test(file);
}

export function detectDocBloatInDiff(diff: string): DocBloatFinding[] {
  const findings: DocBloatFinding[] = [];
  for (const fileDiff of parseAddedLinesByFile(diff)) {
    if (!isDocFile(fileDiff.file)) continue;
    if (fileDiff.addedLines.length === 0) continue;

    const treeHits: string[] = [];
    const migrationHits: string[] = [];
    const inventoryHits: string[] = [];
    for (const line of fileDiff.addedLines) {
      if (TREE_DRAWING_RE.test(line)) treeHits.push(line);
      if (MIGRATION_PHRASE_RE.test(line)) migrationHits.push(line);
      if (FILE_PATH_BULLET_RE.test(line)) inventoryHits.push(line);
    }

    if (treeHits.length > 0) {
      findings.push({
        file: fileDiff.file,
        kind: "tree-drawing",
        detail:
          `${treeHits.length} added line(s) draw a directory tree. ` +
          "Tree art duplicates `ls` and rots immediately — describe boundaries instead.",
        examples: treeHits.slice(0, 3),
      });
    }
    if (migrationHits.length > 0) {
      findings.push({
        file: fileDiff.file,
        kind: "migration-phrase",
        detail:
          `${migrationHits.length} added line(s) read like a changelog/migration note. ` +
          "Git history is the historical record — durable docs should not narrate transitions.",
        examples: migrationHits.slice(0, 3),
      });
    }
    if (inventoryHits.length >= INVENTORY_BUDGET) {
      findings.push({
        file: fileDiff.file,
        kind: "file-inventory",
        detail:
          `${inventoryHits.length} added bullets enumerate file paths (budget ${INVENTORY_BUDGET}). ` +
          "Agents can discover file inventories with `ls`/`grep`; docs should explain boundaries, not contents.",
        examples: inventoryHits.slice(0, 3),
      });
    }
  }
  return findings;
}

export function formatDocBloatMessage(findings: DocBloatFinding[]): string {
  const header =
    "Doc-bloat check rejected staged docs changes. " +
    "AGENTS.md/CLAUDE.md/docs entries should stay concise, high-level, and free of file inventories, directory trees, and migration notes (root AGENTS.md → Documentation; CLAUDE.md → Documentation Philosophy).";
  const blocks = findings.map((finding) => {
    const examples = finding.examples
      .map((line) => `    + ${line.length > 160 ? `${line.slice(0, 157)}...` : line}`)
      .join("\n");
    return `  ${finding.file} [${finding.kind}]: ${finding.detail}\n${examples}`;
  });
  return [header, ...blocks].join("\n\n");
}

const STAGED_DIFF_MAX_BUFFER = 50 * 1024 * 1024;

function readStagedDocDiff(projectDir: string): string {
  return execFileSync(
    "git",
    [
      "diff",
      "--cached",
      "--unified=0",
      "--",
      "*AGENTS.md",
      "*CLAUDE.md",
      "docs/**/*.md",
    ],
    {
      cwd: projectDir,
      encoding: "utf8",
      env: withProtectedGitBareRepositoryEnv(),
      maxBuffer: STAGED_DIFF_MAX_BUFFER,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export function checkDocBloat(projectDir: string): string {
  const diff = readStagedDocDiff(projectDir);
  if (!diff.trim()) {
    return "OK: no staged AGENTS.md/CLAUDE.md/docs changes";
  }
  const findings = detectDocBloatInDiff(diff);
  if (findings.length === 0) {
    return "OK: staged docs changes show no inventory/tree/migration bloat patterns";
  }
  throw new Error(formatDocBloatMessage(findings));
}
