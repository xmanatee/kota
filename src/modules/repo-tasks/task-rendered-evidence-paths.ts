import { isAbsolute, relative } from "node:path";

const BROAD_EVIDENCE_DIRECTORY_NAMES = new Set([
  ".",
  "..",
  ".git",
  ".kota",
  "artifacts",
  "clients",
  "data",
  "dist",
  "docs",
  "evidence",
  "fixtures",
  "node_modules",
  "proof",
  "runs",
  "src",
  "task",
  "tasks",
  "test",
  "tests",
]);
const RUN_DIRECTORY_NAME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:-\d{3})?Z-[A-Za-z0-9_-]+$/;
const NARROW_EVIDENCE_DIRECTORY_NAME_RE =
  /(^|[-_.])(capture|evidence|fixture|probe|proof|rendered|screenshot|screencast|snapshot|trace|transcript)([-_.]|$)/;

function isDirectoryEvidenceReference(evidencePath: string): boolean {
  return evidencePath.trim().endsWith("/");
}

function splitEvidenceDirectoryPath(evidencePath: string): string[] {
  return evidencePath
    .replaceAll("\\", "/")
    .replace(/\/+$/, "")
    .replace(/^\.\//, "")
    .split("/")
    .filter((segment) => segment.length > 0);
}

function hasConcreteDirectorySegment(segment: string | undefined): boolean {
  if (!segment) return false;
  if (/[<>*$]/.test(segment)) return false;
  return !BROAD_EVIDENCE_DIRECTORY_NAMES.has(segment.toLowerCase());
}

export type ConcreteEvidencePathReferenceOptions = {
  taskId?: string | null;
};

function normalizeTaskId(taskId: string | null | undefined): string | null {
  const trimmed = taskId?.trim();
  if (!trimmed || /[<>*$]/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

function hasTaskIdSegment(
  segments: readonly string[],
  taskId: string | null | undefined,
): boolean {
  const normalizedTaskId = normalizeTaskId(taskId);
  if (!normalizedTaskId) return true;
  return segments.some((segment) => segment.toLowerCase() === normalizedTaskId);
}

function isNarrowKotaRunDirectory(
  segments: readonly string[],
  options: ConcreteEvidencePathReferenceOptions = {},
): boolean {
  if (segments[0] !== ".kota" || segments[1] !== "runs") return false;
  return hasConcreteDirectorySegment(segments[2]) &&
    hasTaskIdSegment(segments.slice(2), options.taskId);
}

function isNarrowEvidenceDirectoryReference(
  evidencePath: string,
  options: ConcreteEvidencePathReferenceOptions = {},
): boolean {
  const segments = splitEvidenceDirectoryPath(evidencePath);
  const leaf = segments.at(-1);
  if (!leaf || !hasConcreteDirectorySegment(leaf)) return false;
  if (!hasTaskIdSegment(segments, options.taskId)) return false;
  if (isNarrowKotaRunDirectory(segments, options)) return true;
  return RUN_DIRECTORY_NAME_RE.test(leaf) ||
    leaf.startsWith("task-") ||
    NARROW_EVIDENCE_DIRECTORY_NAME_RE.test(leaf);
}

export function isConcreteEvidencePathReference(
  evidencePath: string,
  options: ConcreteEvidencePathReferenceOptions = {},
): boolean {
  return !isDirectoryEvidenceReference(evidencePath) ||
    isNarrowEvidenceDirectoryReference(evidencePath, options);
}

export function renderedEvidenceDirectoryScanDepth(
  projectDir: string,
  path: string,
  maxRunDepth: number,
  options: ConcreteEvidencePathReferenceOptions = {},
): number | null {
  const relativePath = relative(projectDir, path);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  const normalizedPath = relativePath.replaceAll("\\", "/");
  const segments = splitEvidenceDirectoryPath(normalizedPath);
  if (!isNarrowEvidenceDirectoryReference(`${normalizedPath}/`, options)) return null;
  return isNarrowKotaRunDirectory(segments, options) ? maxRunDepth : 0;
}
