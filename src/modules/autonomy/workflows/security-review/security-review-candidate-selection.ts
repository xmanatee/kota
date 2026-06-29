import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import {
  collectSecurityReviewCandidates,
  securityReviewSurfacesForChangedPath,
} from "./security-review-file-scan.js";
import {
  isSafeRepoRelativePath,
  isSecurityReviewSurface,
  MAX_SCANNED_FILE_BYTES,
  normalizeRepoPath,
  pathHasSkippedSecurityReviewSegment,
  SECURITY_REVIEW_MAX_CANDIDATES,
  SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE,
  SECURITY_REVIEW_SURFACES,
  type SecurityReviewCandidate,
  type SecurityReviewCandidatePacket,
  type SecurityReviewDueTarget,
  type SecurityReviewDueTargetDiagnostic,
  type SecurityReviewDueTargetMissReason,
  type SecurityReviewDueTargetSummary,
  type SecurityReviewScanOptions,
  type SecurityReviewScanResult,
  type SecurityReviewSurface,
  shouldScanSecurityReviewFile,
} from "./security-review-scan-model.js";

const duePayloadChangedSurfaceSchema = z.object({
  surface: z.string().min(1),
  paths: z.array(z.string().min(1)),
}).passthrough();
const duePayloadSchema = z.object({
  changedSurfaces: z.array(duePayloadChangedSurfaceSchema).optional(),
}).passthrough();

function compareDueTargets(a: SecurityReviewDueTarget, b: SecurityReviewDueTarget): number {
  return SECURITY_REVIEW_SURFACES.indexOf(a.surface) - SECURITY_REVIEW_SURFACES.indexOf(b.surface) ||
    a.path.localeCompare(b.path);
}

function dueTargetKey(target: SecurityReviewDueTarget): string {
  return `${target.surface}\0${target.path}`;
}

export function securityReviewDueTargetsFromPayload(
  projectDir: string,
  payload: WorkflowRunTrigger["payload"],
): SecurityReviewDueTarget[] {
  const parsed = duePayloadSchema.safeParse(payload);
  if (!parsed.success) return [];

  const targets = new Map<string, SecurityReviewDueTarget>();
  for (const changedSurface of parsed.data.changedSurfaces ?? []) {
    for (const rawPath of changedSurface.paths) {
      const path = normalizeRepoPath(rawPath);
      if (!isSafeRepoRelativePath(path)) continue;
      const surfaces = isSecurityReviewSurface(changedSurface.surface)
        ? [changedSurface.surface]
        : securityReviewSurfacesForChangedPath(projectDir, path);
      for (const surface of surfaces) {
        targets.set(`${surface}\0${path}`, { surface, path });
      }
    }
  }

  return Array.from(targets.values()).sort(compareDueTargets);
}

function boundCandidates(
  candidates: readonly SecurityReviewCandidate[],
  options: Required<SecurityReviewScanOptions>,
): SecurityReviewCandidate[] {
  const dueTargetKeys = new Set(
    options.dueTargets.map(dueTargetKey),
  );
  const dueCandidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (dueTargetKeys.has(dueTargetKey(candidate))) {
      dueCandidateIds.add(candidate.id);
    }
  }
  if (dueCandidateIds.size > 0) {
    return boundCandidatesByPriority(candidates, options, dueCandidateIds);
  }

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

function boundCandidatesByPriority(
  candidates: readonly SecurityReviewCandidate[],
  options: Required<SecurityReviewScanOptions>,
  dueCandidateIds: ReadonlySet<string>,
): SecurityReviewCandidate[] {
  const selected: SecurityReviewCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedCountsBySurface = new Map<SecurityReviewSurface, number>();

  const selectCandidate = (
    candidate: SecurityReviewCandidate,
    enforceSurfaceCap: boolean,
  ): boolean => {
    if (selected.length >= options.maxCandidates) return false;
    if (selectedIds.has(candidate.id)) return false;
    const selectedForSurface = selectedCountsBySurface.get(candidate.surface) ?? 0;
    if (enforceSurfaceCap && selectedForSurface >= options.maxCandidatesPerSurface) {
      return false;
    }
    selected.push(candidate);
    selectedIds.add(candidate.id);
    selectedCountsBySurface.set(candidate.surface, selectedForSurface + 1);
    return true;
  };

  const representedDueTargetKeys = new Set<string>();
  for (const target of options.dueTargets) {
    const key = dueTargetKey(target);
    if (representedDueTargetKeys.has(key)) continue;
    const representative = candidatesForDueTarget(target, candidates).find(
      (candidate) => !selectedIds.has(candidate.id),
    );
    if (!representative) continue;
    if (!selectCandidate(representative, false)) break;
    representedDueTargetKeys.add(key);
  }

  for (const priority of [true, false]) {
    for (const surface of SECURITY_REVIEW_SURFACES) {
      for (const candidate of candidates) {
        if (candidate.surface !== surface) continue;
        if (selectedIds.has(candidate.id)) continue;
        if (dueCandidateIds.has(candidate.id) !== priority) continue;
        selectCandidate(candidate, true);
      }
    }
  }

  return selected;
}

function candidatesForDueTarget(
  target: SecurityReviewDueTarget,
  candidates: readonly SecurityReviewCandidate[],
): SecurityReviewCandidate[] {
  return candidates.filter((candidate) =>
    candidate.surface === target.surface && candidate.path === target.path
  );
}

function dueTargetMissReason(
  projectDir: string,
  target: SecurityReviewDueTarget,
  allCandidates: readonly SecurityReviewCandidate[],
): SecurityReviewDueTargetMissReason {
  const normalized = normalizeRepoPath(target.path);
  if (!isSafeRepoRelativePath(normalized)) return "outside-project";
  if (pathHasSkippedSecurityReviewSegment(normalized)) return "skipped-directory";
  if (!shouldScanSecurityReviewFile(normalized)) return "unsupported-extension";

  const fullPath = join(projectDir, normalized);
  let fileSize = 0;
  try {
    const stats = statSync(fullPath);
    if (!stats.isFile()) return "not-file";
    fileSize = stats.size;
  } catch {
    return "missing-path";
  }
  if (fileSize > MAX_SCANNED_FILE_BYTES) return "too-large";

  let contentByteLength = 0;
  try {
    contentByteLength = Buffer.byteLength(readFileSync(fullPath, "utf-8"), "utf-8");
  } catch {
    return "read-error";
  }
  if (contentByteLength > MAX_SCANNED_FILE_BYTES) return "too-large";

  const pathCandidates = allCandidates.filter((candidate) => candidate.path === normalized);
  if (pathCandidates.length > 0) return "no-surface-matcher";
  return "no-matcher";
}

function summarizeDueTargets(args: {
  projectDir: string;
  dueTargets: readonly SecurityReviewDueTarget[];
  allCandidates: readonly SecurityReviewCandidate[];
  selectedCandidates: readonly SecurityReviewCandidate[];
}): SecurityReviewDueTargetSummary {
  const diagnostics = args.dueTargets.map((target): SecurityReviewDueTargetDiagnostic => {
    const selected = candidatesForDueTarget(target, args.selectedCandidates);
    if (selected.length > 0) {
      return {
        surface: target.surface,
        path: target.path,
        status: "matched",
        candidateIds: selected.map((candidate) => candidate.id),
      };
    }

    const available = candidatesForDueTarget(target, args.allCandidates);
    return {
      surface: target.surface,
      path: target.path,
      status: "missed",
      reason: available.length > 0
        ? "candidate-cap"
        : dueTargetMissReason(args.projectDir, target, args.allCandidates),
      candidateIds: available.map((candidate) => candidate.id),
    };
  });

  return {
    total: diagnostics.length,
    matched: diagnostics.filter((diagnostic) => diagnostic.status === "matched").length,
    missed: diagnostics.filter((diagnostic) => diagnostic.status === "missed").length,
    diagnostics,
  };
}

export function scanSecurityReviewCandidates(
  projectDir: string,
  options: SecurityReviewScanOptions = {},
): SecurityReviewScanResult {
  const resolvedOptions = {
    maxCandidates: options.maxCandidates ?? SECURITY_REVIEW_MAX_CANDIDATES,
    maxCandidatesPerSurface:
      options.maxCandidatesPerSurface ?? SECURITY_REVIEW_MAX_CANDIDATES_PER_SURFACE,
    dueTargets: options.dueTargets ?? [],
  };
  const allCandidates = collectSecurityReviewCandidates(projectDir);
  const candidates = boundCandidates(allCandidates, resolvedOptions);
  return {
    candidates,
    candidateCount: candidates.length,
    totalMatchedCandidates: allCandidates.length,
    truncated: allCandidates.length > candidates.length,
    maxCandidates: resolvedOptions.maxCandidates,
    maxCandidatesPerSurface: resolvedOptions.maxCandidatesPerSurface,
    dueTargets: summarizeDueTargets({
      projectDir,
      dueTargets: resolvedOptions.dueTargets,
      allCandidates,
      selectedCandidates: candidates,
    }),
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
