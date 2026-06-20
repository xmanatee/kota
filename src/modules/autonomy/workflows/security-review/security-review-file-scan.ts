import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import {
  isSafeRepoRelativePath,
  MAX_SCANNED_FILE_BYTES,
  normalizeRepoPath,
  PREFERRED_SOURCE_PREFIXES,
  pathHasSkippedSecurityReviewSegment,
  SECURITY_REVIEW_SURFACES,
  type SecurityReviewCandidate,
  type SecurityReviewSurface,
  SKIPPED_SECURITY_REVIEW_DIRS,
  SOURCE_CODE_EXTENSIONS,
  SURFACE_MATCHERS,
  shouldScanSecurityReviewFile,
} from "./security-review-scan-model.js";

export function securityReviewSurfacesForPath(path: string): SecurityReviewSurface[] {
  const normalized = normalizeRepoPath(path);
  return SECURITY_REVIEW_SURFACES.filter((surface) =>
    PREFERRED_SOURCE_PREFIXES[surface].some((prefix) => normalized.startsWith(prefix)),
  );
}

function listScannableFiles(projectDir: string, dir = projectDir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_SECURITY_REVIEW_DIRS.has(entry.name)) continue;
      files.push(...listScannableFiles(projectDir, join(dir, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    const fullPath = join(dir, entry.name);
    if (shouldScanSecurityReviewFile(fullPath)) files.push(relative(projectDir, fullPath));
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
  const preferredSource = preferredSourcePrefixRank(candidate) !== Number.MAX_SAFE_INTEGER;
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

export function compareSecurityReviewCandidates(
  a: SecurityReviewCandidate,
  b: SecurityReviewCandidate,
): number {
  return SECURITY_REVIEW_SURFACES.indexOf(a.surface) - SECURITY_REVIEW_SURFACES.indexOf(b.surface) ||
    candidatePathRank(a) - candidatePathRank(b) ||
    preferredSourcePrefixRank(a) - preferredSourcePrefixRank(b) ||
    a.path.localeCompare(b.path) ||
    a.line - b.line ||
    a.matcher.localeCompare(b.matcher);
}

export function scanSecurityReviewCandidatesForPath(
  projectDir: string,
  path: string,
): SecurityReviewCandidate[] {
  const normalized = normalizeRepoPath(path);
  if (
    !isSafeRepoRelativePath(normalized) ||
    pathHasSkippedSecurityReviewSegment(normalized) ||
    !shouldScanSecurityReviewFile(normalized)
  ) {
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

export function collectSecurityReviewCandidates(projectDir: string): SecurityReviewCandidate[] {
  const candidates: SecurityReviewCandidate[] = [];
  for (const path of listScannableFiles(projectDir)) {
    candidates.push(...scanSecurityReviewCandidatesForPath(projectDir, path));
  }
  return candidates.sort(compareSecurityReviewCandidates);
}
