import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { z } from "zod";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  getRepoTaskStateDir,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { slugifyTaskTitle } from "#modules/repo-tasks/repo-tasks-operations.js";

export const SECURITY_REVIEW_MAX_CANDIDATES = 35;
export const SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE = 5;

export const SECURITY_REVIEW_SURFACES = [
  "auth-approval-boundary",
  "daemon-control-route",
  "tool-execution",
  "external-fetch",
  "secret-handling",
  "mcp-transport",
  "task-workflow-mutation",
] as const;

export type SecurityReviewSurface = (typeof SECURITY_REVIEW_SURFACES)[number];

export type SecurityReviewCandidate = {
  id: string;
  surface: SecurityReviewSurface;
  path: string;
  line: number;
  matcher: string;
  excerpt: string;
};

export type SecurityReviewScanOptions = {
  maxCandidates?: number;
  maxCandidatesPerSurface?: number;
};

export type SecurityReviewScanResult = {
  candidates: SecurityReviewCandidate[];
  candidateCount: number;
  totalMatchedCandidates: number;
  truncated: boolean;
  maxCandidates: number;
  maxCandidatesPerSurface: number;
};

export type SecurityReviewCandidatePacket = SecurityReviewScanResult & {
  artifactPath: string;
};

const SCANNABLE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const SKIPPED_DIRS = new Set([
  ".build",
  ".claude",
  ".git",
  ".kota",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

const MAX_SCANNED_FILE_BYTES = 1_000_000;

const SOURCE_CODE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

const PREFERRED_SOURCE_PREFIXES: {
  readonly [Surface in SecurityReviewSurface]: readonly string[];
} = {
  "auth-approval-boundary": [
    "src/modules/approval-queue/",
    "src/modules/owner-questions/",
    "src/modules/injection-defense/",
    "src/core/tools/",
  ],
  "daemon-control-route": [
    "src/core/daemon/",
    "src/modules/daemon-ops/",
    "src/modules/workflow-ops/routes/",
  ],
  "tool-execution": [
    "src/modules/execution/",
    "src/core/tools/",
    "src/core/workflow/",
  ],
  "external-fetch": [
    "src/modules/web-access/",
    "src/modules/browser/",
    "src/modules/google-workspace/",
    "src/modules/push-notification/",
    "src/modules/model-clients/",
  ],
  "secret-handling": [
    "src/modules/secrets/",
    "src/core/config/secrets",
    "src/modules/webhook/",
    "src/modules/model-clients/",
  ],
  "mcp-transport": [
    "src/core/mcp/",
    "src/modules/mcp-server/",
    "src/modules/injection-defense/",
  ],
  "task-workflow-mutation": [
    "src/modules/autonomy/workflows/",
    "src/modules/repo-tasks/",
    "src/core/workflow/",
  ],
};

function normalizeRepoPath(path: string): string {
  return path.split("\\").join("/");
}

export function securityReviewSurfacesForPath(path: string): SecurityReviewSurface[] {
  const normalized = normalizeRepoPath(path);
  return SECURITY_REVIEW_SURFACES.filter((surface) =>
    PREFERRED_SOURCE_PREFIXES[surface].some((prefix) => normalized.startsWith(prefix)),
  );
}

type SurfaceMatcher = {
  surface: SecurityReviewSurface;
  name: string;
  pattern: RegExp;
};

const SURFACE_MATCHERS: readonly SurfaceMatcher[] = [
  {
    surface: "auth-approval-boundary",
    name: "auth-or-approval-boundary",
    pattern: /\b(Authorization|Bearer|approval|approve|askOwner|authHeaders|guardrail|permission)\b/i,
  },
  {
    surface: "daemon-control-route",
    name: "daemon-control-route",
    pattern: /\b(DaemonControl|daemon-control|fetchRaw)\b|\/api\/|router\.(get|post|patch|delete)\s*\(/i,
  },
  {
    surface: "tool-execution",
    name: "tool-execution",
    pattern: /\b(execFileSync|execSync|spawnSync|runTool|allowedTools|disallowedTools)\b|shell:\s*true/i,
  },
  {
    surface: "external-fetch",
    name: "external-fetch",
    pattern: /\bfetch\s*\(|\bhttpRequest\b|\bwebFetch\b|https?:\/\//i,
  },
  {
    surface: "secret-handling",
    name: "secret-handling",
    pattern: /\b(get_secret|secrets?|apiKey|process\.env|[A-Z0-9_]*SECRET[A-Z0-9_]*)\b/,
  },
  {
    surface: "mcp-transport",
    name: "mcp-transport",
    pattern: /\b(MCP|Mcp|mcp|stdio|SSE|sse)\b/,
  },
  {
    surface: "task-workflow-mutation",
    name: "task-workflow-mutation",
    pattern: /\b(moveTaskById|createNormalizedTask|commitWorkflowChanges|writeFileSync)\b|workflow\.|git add|data\/tasks/i,
  },
];

const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const verdictSchema = z.enum(["confirmed", "rejected", "follow-up-needed"]);
const evidenceSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive(),
  excerpt: z.string().min(1),
}).strict();
const investigationFindingSchema = z.object({
  id: z.string().min(1),
  candidateId: z.string().min(1),
  claim: z.string().min(1),
  severity: severitySchema,
  affectedPath: z.string().min(1),
  evidence: z.array(evidenceSchema).min(1),
  recommendedOutcome: z.string().min(1),
}).strict();
const revalidatedFindingSchema = investigationFindingSchema.extend({
  verdict: verdictSchema,
  rationale: z.string().min(1),
}).strict();
const revalidationVerdictSchema = z.object({
  id: z.string().min(1),
  verdict: verdictSchema,
  rationale: z.string().min(1),
}).strict();
const investigationOutputSchema = z.object({
  findings: z.array(investigationFindingSchema),
}).strict();
const revalidationOutputSchema = z.object({
  findings: z.array(revalidatedFindingSchema),
  summary: z.string().min(1),
}).strict();
const revalidationVerdictOutputSchema = z.object({
  findings: z.array(revalidationVerdictSchema),
  summary: z.string().min(1),
}).strict();

export type SecurityFindingSeverity = z.infer<typeof severitySchema>;
export type SecurityFindingVerdict = z.infer<typeof verdictSchema>;
export type SecurityFindingEvidence = z.infer<typeof evidenceSchema>;
export type SecurityInvestigationFinding = z.infer<typeof investigationFindingSchema>;
export type SecurityRevalidatedFinding = z.infer<typeof revalidatedFindingSchema>;
export type SecurityInvestigationOutput = z.infer<typeof investigationOutputSchema>;
export type SecurityRevalidationOutput = z.infer<typeof revalidationOutputSchema>;
export type SecurityRevalidationVerdictOutput = z.infer<typeof revalidationVerdictOutputSchema>;

type RawInvestigationOutput = Parameters<typeof investigationOutputSchema.parse>[0];
type RawRevalidationOutput = Parameters<typeof revalidationVerdictOutputSchema.parse>[0];

export function decodeSecurityInvestigationOutput(
  raw: RawInvestigationOutput,
): SecurityInvestigationOutput {
  return investigationOutputSchema.parse(raw);
}

export function decodeSecurityRevalidationVerdictOutput(
  raw: RawRevalidationOutput,
): SecurityRevalidationVerdictOutput {
  return revalidationVerdictOutputSchema.parse(raw);
}

function formatFindingIds(ids: readonly string[]): string {
  return ids.map((id) => `"${id}"`).join(", ");
}

export function decodeSecurityRevalidationOutputForInvestigation(
  raw: RawRevalidationOutput,
  investigation: SecurityInvestigationOutput,
): SecurityRevalidationOutput {
  const output = decodeSecurityRevalidationVerdictOutput(raw);
  const expectedById = new Map(
    investigation.findings.map((finding) => [finding.id, finding]),
  );
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];
  const unknownIds: string[] = [];
  const mergedFindings: SecurityRevalidatedFinding[] = [];

  for (const verdict of output.findings) {
    if (seenIds.has(verdict.id)) {
      duplicateIds.push(verdict.id);
      continue;
    }
    seenIds.add(verdict.id);
    const expected = expectedById.get(verdict.id);
    if (!expected) {
      unknownIds.push(verdict.id);
      continue;
    }
    mergedFindings.push({
      ...expected,
      verdict: verdict.verdict,
      rationale: verdict.rationale,
    });
  }

  if (duplicateIds.length > 0) {
    throw new Error(
      `Security revalidation duplicated investigation finding verdicts: ${formatFindingIds(duplicateIds)}.`,
    );
  }
  if (unknownIds.length > 0) {
    throw new Error(
      `Security revalidation returned unknown investigation findings: ${formatFindingIds(unknownIds)}.`,
    );
  }

  const missingIds = investigation.findings
    .map((finding) => finding.id)
    .filter((id) => !seenIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(
      `Security revalidation omitted investigation finding verdicts: ${formatFindingIds(missingIds)}.`,
    );
  }

  return {
    findings: mergedFindings,
    summary: output.summary,
  };
}

function shouldScanFile(path: string): boolean {
  const ext = extname(path);
  return SCANNABLE_EXTENSIONS.has(ext);
}

function pathHasSkippedSegment(path: string): boolean {
  return normalizeRepoPath(path).split("/").some((segment) => SKIPPED_DIRS.has(segment));
}

function listScannableFiles(projectDir: string, dir = projectDir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      files.push(...listScannableFiles(projectDir, join(dir, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    const fullPath = join(dir, entry.name);
    if (shouldScanFile(fullPath)) files.push(relative(projectDir, fullPath));
  }
  return files;
}

function excerptLine(line: string): string {
  return line.trim().replace(/\s+/g, " ").slice(0, 240);
}

function isTestPath(path: string): boolean {
  return /(^|\/)(__tests__|test|tests)\//.test(path) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function hasPreferredSourcePrefix(candidate: SecurityReviewCandidate): boolean {
  return preferredSourcePrefixRank(candidate) !== Number.MAX_SAFE_INTEGER;
}

function preferredSourcePrefixRank(candidate: SecurityReviewCandidate): number {
  const index = PREFERRED_SOURCE_PREFIXES[candidate.surface].findIndex((prefix) =>
    candidate.path.startsWith(prefix),
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function isSourceCodePath(path: string): boolean {
  return path.startsWith("src/") && SOURCE_CODE_EXTENSIONS.has(extname(path));
}

function candidatePathRank(candidate: SecurityReviewCandidate): number {
  const preferredSource = hasPreferredSourcePrefix(candidate);
  const sourceCode = isSourceCodePath(candidate.path);
  const testPath = isTestPath(candidate.path);

  if (preferredSource && sourceCode && !testPath) return 0;
  if (sourceCode && !testPath) return 1;
  if (preferredSource && sourceCode) return 2;
  if (sourceCode) return 3;
  if (candidate.path.startsWith("src/")) return 4;
  if (candidate.path.endsWith(".md")) return 6;
  return 5;
}

function isFirstMeaningfulLine(lines: readonly string[], index: number): boolean {
  if (lines[index]?.trim()) {
    return lines.slice(0, index).every((line) => line.trim().length === 0);
  }
  return false;
}

function collectAllCandidates(projectDir: string): SecurityReviewCandidate[] {
  const candidates: SecurityReviewCandidate[] = [];
  for (const path of listScannableFiles(projectDir)) {
    candidates.push(...scanSecurityReviewCandidatesForPath(projectDir, path));
  }
  return candidates.sort((a, b) =>
    SECURITY_REVIEW_SURFACES.indexOf(a.surface) - SECURITY_REVIEW_SURFACES.indexOf(b.surface) ||
    candidatePathRank(a) - candidatePathRank(b) ||
    preferredSourcePrefixRank(a) - preferredSourcePrefixRank(b) ||
    a.path.localeCompare(b.path) ||
    a.line - b.line ||
    a.matcher.localeCompare(b.matcher)
  );
}

export function scanSecurityReviewCandidatesForPath(
  projectDir: string,
  path: string,
): SecurityReviewCandidate[] {
  const normalized = normalizeRepoPath(path);
  if (pathHasSkippedSegment(normalized) || !shouldScanFile(normalized)) {
    return [];
  }

  const fullPath = join(projectDir, normalized);
  let fileSize = 0;
  try {
    const stats = statSync(fullPath);
    if (!stats.isFile()) return [];
    fileSize = stats.size;
  } catch {
    return [];
  }
  if (fileSize > MAX_SCANNED_FILE_BYTES) return [];

  const content = readFileSync(fullPath, "utf-8");
  if (Buffer.byteLength(content, "utf-8") > MAX_SCANNED_FILE_BYTES) {
    return [];
  }

  const candidates: SecurityReviewCandidate[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    for (const matcher of SURFACE_MATCHERS) {
      const lineMatched = matcher.pattern.test(line);
      const pathMatched = matcher.pattern.test(normalized);
      if (!lineMatched && !pathMatched) continue;
      if (!lineMatched && !isFirstMeaningfulLine(lines, index)) continue;
      const lineNumber = index + 1;
      candidates.push({
        id: `${matcher.surface}:${normalized}:${lineNumber}`,
        surface: matcher.surface,
        path: normalized,
        line: lineNumber,
        matcher: matcher.name,
        excerpt: excerptLine(line || normalized),
      });
    }
  }
  return candidates;
}

export function securityReviewSurfacesForChangedPath(
  projectDir: string,
  path: string,
): SecurityReviewSurface[] {
  const surfaces = new Set<SecurityReviewSurface>(securityReviewSurfacesForPath(path));
  for (const candidate of scanSecurityReviewCandidatesForPath(projectDir, path)) {
    surfaces.add(candidate.surface);
  }
  return SECURITY_REVIEW_SURFACES.filter((surface) => surfaces.has(surface));
}

function boundCandidates(
  candidates: readonly SecurityReviewCandidate[],
  options: Required<SecurityReviewScanOptions>,
): SecurityReviewCandidate[] {
  const selected: SecurityReviewCandidate[] = [];
  for (const surface of SECURITY_REVIEW_SURFACES) {
    let selectedForSurface = 0;
    for (const candidate of candidates) {
      if (candidate.surface !== surface) continue;
      if (selectedForSurface >= options.maxCandidatesPerSurface) break;
      if (selected.length >= options.maxCandidates) return selected;
      selected.push(candidate);
      selectedForSurface += 1;
    }
  }
  return selected;
}

export function scanSecurityReviewCandidates(
  projectDir: string,
  options: SecurityReviewScanOptions = {},
): SecurityReviewScanResult {
  const resolvedOptions = {
    maxCandidates: options.maxCandidates ?? SECURITY_REVIEW_MAX_CANDIDATES,
    maxCandidatesPerSurface:
      options.maxCandidatesPerSurface ?? SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE,
  };
  const allCandidates = collectAllCandidates(projectDir);
  const candidates = boundCandidates(allCandidates, resolvedOptions);
  return {
    candidates,
    candidateCount: candidates.length,
    totalMatchedCandidates: allCandidates.length,
    truncated: allCandidates.length > candidates.length,
    maxCandidates: resolvedOptions.maxCandidates,
    maxCandidatesPerSurface: resolvedOptions.maxCandidatesPerSurface,
  };
}

export function writeJsonArtifact<T>(
  runDirPath: string,
  filename: string,
  payload: T,
): string {
  mkdirSync(runDirPath, { recursive: true });
  const artifactPath = join(runDirPath, filename);
  writeFileSync(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
  return artifactPath;
}

export function scanAndWriteSecurityReviewCandidates(
  projectDir: string,
  runDirPath: string,
  options: SecurityReviewScanOptions = {},
): SecurityReviewCandidatePacket {
  const scan = scanSecurityReviewCandidates(projectDir, options);
  const artifactPath = writeJsonArtifact(runDirPath, "security-review-candidates.json", scan);
  return { ...scan, artifactPath };
}

function taskPriorityForSeverity(severity: SecurityFindingSeverity): "p1" | "p2" | "p3" {
  if (severity === "critical" || severity === "high") return "p1";
  if (severity === "medium") return "p2";
  return "p3";
}

function findExistingTask(projectDir: string, id: string): { state: RepoTaskState; path: string } | null {
  for (const state of REPO_TASK_STATES) {
    const taskPath = join(getRepoTaskStateDir(projectDir, state), `${id}.md`);
    if (existsSync(taskPath)) return { state, path: taskPath };
  }
  return null;
}

function buildFindingTaskBody(args: {
  runId: string;
  finding: SecurityRevalidatedFinding;
}): string {
  const { finding, runId } = args;
  const evidence = finding.evidence
    .map((entry) => `- ${entry.path}:${entry.line} - ${entry.excerpt}`)
    .join("\n");
  return [
    "",
    "## Problem",
    "",
    "The security-review workflow confirmed an application-security finding.",
    "",
    `severity: ${finding.severity}`,
    `affected path: ${finding.affectedPath}`,
    `claim: ${finding.claim}`,
    "",
    "## Desired Outcome",
    "",
    finding.recommendedOutcome,
    "",
    "## Constraints",
    "",
    "- Preserve the confirmed security claim and cited evidence until the fix lands.",
    "- Do not weaken authorization, approval, tool-risk, secret-handling, or injection-defense boundaries to make the finding disappear.",
    "",
    "## Done When",
    "",
    "- The cited vulnerability is fixed or proven impossible with code-level evidence.",
    "- Focused regression coverage guards the fixed boundary.",
    "- The task records the final verification command or artifact.",
    "",
    "## Source / Intent",
    "",
    `Created by security-review workflow run ${runId}.`,
    "",
    `finding id: ${finding.id}`,
    `candidate id: ${finding.candidateId}`,
    `verdict: ${finding.verdict}`,
    `rationale: ${finding.rationale}`,
    "",
    "Evidence:",
    "",
    evidence,
    "",
    "## Initiative",
    "",
    "Agentic security review for autonomous coding infrastructure.",
    "",
    "## Acceptance Evidence",
    "",
    "- Regression test, runtime probe, or review transcript showing the cited security boundary is fixed.",
    "",
  ].join("\n");
}

function stageBestEffort(projectDir: string, path: string): void {
  try {
    execFileSync("git", ["add", path], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "ignore",
    });
  } catch {
    // The workflow commit step stages the final path set; direct task creation
    // remains useful in test or sandbox environments without a writable index.
  }
}

export type SecurityFindingTaskResult = {
  createdTaskIds: string[];
  updatedTaskIds: string[];
  skippedFindingIds: string[];
  taskPaths: string[];
};

export function createOrUpdateSecurityFindingTasks(
  projectDir: string,
  args: {
    runId: string;
    findings: readonly SecurityRevalidatedFinding[];
  },
): SecurityFindingTaskResult {
  const createdTaskIds: string[] = [];
  const updatedTaskIds: string[] = [];
  const skippedFindingIds: string[] = [];
  const taskPaths: string[] = [];

  for (const finding of args.findings) {
    if (finding.verdict !== "confirmed") {
      skippedFindingIds.push(finding.id);
      continue;
    }
    const title = `Security review: ${finding.claim}`;
    const id = `task-${slugifyTaskTitle(title)}`;
    const existing = findExistingTask(projectDir, id);
    const state = existing?.state ?? "ready";
    const taskPath = existing?.path ?? join(getRepoTaskStateDir(projectDir, "ready"), `${id}.md`);
    mkdirSync(dirname(taskPath), { recursive: true });
    const now = new Date().toISOString();
    const existingCreatedAt = existing
      ? String(parseFlatFrontMatter(readFileSync(existing.path, "utf-8")).attrs.created_at ?? now)
      : now;
    const attrs: Record<string, string> = {
      id,
      title,
      status: state,
      priority: taskPriorityForSeverity(finding.severity),
      area: "security",
      summary: finding.claim,
      created_at: existingCreatedAt,
      updated_at: now,
    };
    writeFileSync(
      taskPath,
      serializeFlatFrontMatter(attrs, buildFindingTaskBody({ runId: args.runId, finding })),
      "utf-8",
    );
    stageBestEffort(projectDir, taskPath);
    taskPaths.push(taskPath);
    if (existing) updatedTaskIds.push(id);
    else createdTaskIds.push(id);
  }

  return { createdTaskIds, updatedTaskIds, skippedFindingIds, taskPaths };
}

export function writeSecurityReviewOutcome(
  runDirPath: string,
  payload: Record<string, string | number | boolean | string[]>,
): { written: true; artifactPath: string } {
  const artifactPath = writeJsonArtifact(runDirPath, "security-review-outcome.json", payload);
  return { written: true, artifactPath };
}
