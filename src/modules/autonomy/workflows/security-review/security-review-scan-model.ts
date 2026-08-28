import { extname } from "node:path";

export const SECURITY_REVIEW_MAX_CANDIDATES = 35;
export const SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE = 5;
export const SECURITY_REVIEW_MAX_DUE_PATHS = 100;

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

export type SecurityReviewDueTarget = {
  surface: SecurityReviewSurface;
  path: string;
};

export type SecurityReviewDueTargetMissReason =
  | "candidate-cap"
  | "missing-path"
  | "no-matcher"
  | "no-surface-matcher"
  | "not-file"
  | "outside-scope"
  | "read-error"
  | "skipped-directory"
  | "too-large"
  | "unsupported-extension";

export type SecurityReviewDueTargetDiagnostic = {
  surface: SecurityReviewSurface;
  path: string;
} & (
  | {
      status: "matched";
      candidateIds: string[];
    }
  | {
      status: "missed";
      reason: SecurityReviewDueTargetMissReason;
      candidateIds: string[];
    }
);

export type SecurityReviewDueTargetSummary = {
  total: number;
  matched: number;
  missed: number;
  diagnostics: SecurityReviewDueTargetDiagnostic[];
};

export type SecurityReviewScanOptions = {
  maxCandidates?: number;
  maxCandidatesPerSurface?: number;
  dueTargets?: readonly SecurityReviewDueTarget[];
};

export type SecurityReviewScanResult = {
  candidates: SecurityReviewCandidate[];
  candidateCount: number;
  totalMatchedCandidates: number;
  truncated: boolean;
  maxCandidates: number;
  maxCandidatesPerSurface: number;
  dueTargets: SecurityReviewDueTargetSummary;
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

export const SKIPPED_SECURITY_REVIEW_DIRS = new Set([
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

export const MAX_SCANNED_FILE_BYTES = 1_000_000;

export const SOURCE_CODE_EXTENSIONS = new Set([
  ".cjs",
  ".js",
  ".jsx",
  ".mjs",
  ".ts",
  ".tsx",
]);

export const PREFERRED_SOURCE_PREFIXES: {
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

export type SurfaceMatcher = {
  surface: SecurityReviewSurface;
  name: string;
  pattern: RegExp;
};

export const SURFACE_MATCHERS: readonly SurfaceMatcher[] = [
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
    pattern: /\b(moveTaskById|createNormalizedTask|writeFileSync)\b|workflow\.|git add|data\/tasks/i,
  },
];

export function normalizeRepoPath(path: string): string {
  return path.split("\\").join("/");
}

export function isSafeRepoRelativePath(path: string): boolean {
  const normalized = normalizeRepoPath(path);
  return normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !normalized.split("/").includes("..");
}

export function isSecurityReviewSurface(value: string): value is SecurityReviewSurface {
  return SECURITY_REVIEW_SURFACES.some((surface) => surface === value);
}

export function shouldScanSecurityReviewFile(path: string): boolean {
  return SCANNABLE_EXTENSIONS.has(extname(path));
}

export function pathHasSkippedSecurityReviewSegment(path: string): boolean {
  return normalizeRepoPath(path)
    .split("/")
    .some((segment) => SKIPPED_SECURITY_REVIEW_DIRS.has(segment));
}
