import { basename } from "node:path";

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
