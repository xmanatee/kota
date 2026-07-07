import { type Dirent, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  type ConcreteEvidencePathReferenceOptions,
  renderedEvidenceDirectoryScanDepth,
} from "./task-rendered-evidence-paths.js";

const VISUAL_PROOF_EXTENSIONS = new Set([
  ".gif",
  ".html",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".png",
  ".webm",
  ".webp",
]);
const TEXT_PROOF_EXTENSIONS = new Set([".json", ".md", ".txt"]);
const ARCHIVE_PROOF_EXTENSIONS = new Set([".zip"]);
const TEXT_PROOF_NAME_RE =
  /(^|[-_.])(capture|chat|conversation|exchange|fixture|message|messages|probe|proof|rendered|reply|screenshot|screencast|snapshot|slack|status|telegram|trace|transcript)([-_.]|$)/;
const PREFLIGHT_ONLY_TEXT_RE =
  /^(build|install|lint|setup|smoke|smoke-test|static-test|test|tests|typecheck|unit|validation)([-_.].*)?\.(log|txt)$/;
const MAX_RENDERED_EVIDENCE_SCAN_DEPTH = 4;

function fileLooksLikeRenderedProof(path: string): boolean {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    return false;
  }
  if (!stats.isFile() || stats.size === 0) return false;

  const name = basename(path).toLowerCase();
  const nameLooksLikeProof = TEXT_PROOF_NAME_RE.test(name);
  if (PREFLIGHT_ONLY_TEXT_RE.test(name) && !nameLooksLikeProof) return false;

  const ext = extname(name);
  if (VISUAL_PROOF_EXTENSIONS.has(ext)) return true;
  if (ARCHIVE_PROOF_EXTENSIONS.has(ext)) return /\btrace\b/i.test(name);
  return TEXT_PROOF_EXTENSIONS.has(ext) && nameLooksLikeProof;
}

function directoryContainsRenderedProof(path: string, maxDepth: number, depth = 0): boolean {
  if (depth > maxDepth) return false;
  let entries: Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isFile() && fileLooksLikeRenderedProof(childPath)) return true;
    if (
      entry.isDirectory() &&
      depth < maxDepth &&
      directoryContainsRenderedProof(childPath, maxDepth, depth + 1)
    ) {
      return true;
    }
  }
  return false;
}

function directoryEvidenceScanDepth(
  projectDir: string,
  path: string,
  options: ConcreteEvidencePathReferenceOptions,
): number | null {
  return renderedEvidenceDirectoryScanDepth(
    projectDir,
    path,
    MAX_RENDERED_EVIDENCE_SCAN_DEPTH,
    options,
  );
}

export function pathContainsRenderedProof(
  path: string,
  projectDir: string,
  options: ConcreteEvidencePathReferenceOptions,
): boolean {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    return false;
  }
  if (stats.isFile()) return fileLooksLikeRenderedProof(path);
  if (stats.isDirectory()) {
    const maxDepth = directoryEvidenceScanDepth(projectDir, path, options);
    return maxDepth !== null && directoryContainsRenderedProof(path, maxDepth);
  }
  return false;
}
