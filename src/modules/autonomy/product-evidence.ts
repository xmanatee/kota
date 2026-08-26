import { existsSync, readdirSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

const OPERATOR_EVIDENCE_NAME_RE =
  /\b(?:screenshot|screencast|transcript|rendered|runtime-probe|snapshot|fixture|playwright|trace|demo|operator-journey)\b/i;

const OPERATOR_EVIDENCE_TEXT_RE =
  /\b(?:screenshot|screencast|transcript|rendered(?:\s+(?:artifact|fixture|output|dom|message|view))?|runtime probe|snapshot|playwright trace|demo|operator journey|visual evidence)\b/i;

const OPERATOR_EVIDENCE_EXTENSIONS = new Set([
  ".har",
  ".html",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp4",
  ".png",
  ".trace",
  ".webm",
  ".webp",
  ".zip",
]);

export function mentionsOperatorEvidence(value: string): boolean {
  return OPERATOR_EVIDENCE_TEXT_RE.test(value);
}

export function isOperatorEvidencePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const name = basename(normalized);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
  return (
    OPERATOR_EVIDENCE_NAME_RE.test(normalized) ||
    OPERATOR_EVIDENCE_EXTENSIONS.has(extension) ||
    normalized.includes("/fixtures/") ||
    normalized.includes("/__snapshots__/")
  );
}

function listRunArtifactEvidenceRefs(runDirPath: string): string[] {
  if (!existsSync(runDirPath)) return [];
  const refs: string[] = [];
  const maxRefs = 200;
  function visit(dir: string, prefix: string): void {
    if (refs.length >= maxRefs) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (refs.length >= maxRefs) return;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absPath, relPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isOperatorEvidencePath(relPath)) refs.push(relPath);
    }
  }
  visit(runDirPath, "");
  return refs.sort();
}

function changedFileEvidenceRefs(changedFiles: string): string[] {
  return changedFiles
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.replace(/\\/g, "/").startsWith(".kota/"))
    .filter(isOperatorEvidencePath)
    .sort();
}

export function resolveDurableOperatorEvidenceDir(
  workspaceRoot: string,
  runDirPath: string,
): string {
  const resolvedWorkspaceRoot = resolve(workspaceRoot);
  const runRoot = resolve(runDirPath);
  const relativeRunDir = relative(resolvedWorkspaceRoot, runRoot);
  if (relativeRunDir.startsWith("..") || isAbsolute(relativeRunDir)) {
    return runDirPath;
  }
  const parts = relativeRunDir.split(sep);
  if (
    parts.length !== 3 ||
    parts[0] !== ".kota" ||
    parts[1] !== "builder-evidence"
  ) {
    return runDirPath;
  }
  return join(resolvedWorkspaceRoot, ".kota", "runs", parts[2], "evidence");
}

export function collectOperatorEvidenceRefs(args: {
  evidenceDirPath: string;
  changedFiles: string;
  hasRuntimeProbeResult: boolean;
}): string[] {
  return [
    ...listRunArtifactEvidenceRefs(args.evidenceDirPath).map((ref) => `run:${ref}`),
    ...changedFileEvidenceRefs(args.changedFiles).map((ref) => `changed:${ref}`),
    ...(args.hasRuntimeProbeResult ? ["run:runtime-probe.json"] : []),
  ];
}
