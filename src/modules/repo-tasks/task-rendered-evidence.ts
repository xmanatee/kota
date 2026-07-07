import { type Dirent, readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

const CLIENT_CHANNEL_AREAS: ReadonlySet<string> = new Set(["client", "channel"]);

const RENDERED_EVIDENCE_DECLARATION_KEYWORDS = [
  /\bscreenshots?\b/i,
  /\bscreencasts?\b/i,
  /\brendered (?:artifact|evidence|fixture|view|snapshot|output|screenshot)s?\b/i,
  /\btranscripts?\b/i,
  /\bruntime probes?\b/i,
  /\bvisual evidence\b/i,
] as const;

const ACCEPTED_RENDERED_EVIDENCE_KEYWORDS = [
  /\bscreenshots?\b/i,
  /\bscreencasts?\b/i,
  /\brendered (?:artifact|evidence|fixture|view|snapshot|output)s?\b/i,
  /\btranscripts?\b/i,
  /\b(?:dashboard|status|cli|command|curl|chat)\s+transcripts?\b/i,
  /\bruntime probes?\b/i,
  /\bdaemon route runtime probes?\b/i,
  /\b(?:playwright\s+)?traces?\b/i,
  /\bhtml reports?\b/i,
  /\bsnapshot(?: tests?)?\b/i,
  /\bnative snapshots?\b/i,
  /\b(?:rendered|output)\s+fixtures?\b/i,
  /\boperator[- ]capture(?:d)?\b/i,
] as const;

const CONCRETE_RENDERED_EVIDENCE_SECTIONS = [
  "Acceptance Evidence",
  "Completion Evidence",
  "Completion Notes",
  "Closure / Supersession",
] as const;

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
const RUNTIME_PROBE_SCRIPT_RE = /^[A-Za-z0-9][A-Za-z0-9:_./-]*$/;

const OPERATOR_CLIENT_SURFACE_KEYWORDS = [
  /\boperator[- ](?:client|facing|visible)\b/i,
  /\bcli\b/i,
  /\btui\b/i,
  /\bterminal\b/i,
  /\bnavigator\b/i,
  /\bdashboard\b/i,
  /\bdaemon[- ]control\b/i,
  /\bdaemon[- ]backed\b/i,
  /\bkota status\b/i,
  /\bstatus (?:view|screen|panel|dashboard|command|output|transcript)\b/i,
  /\bsetup\b/i,
  /\bauth(?:entication)? requirements?\b/i,
  /\bapprovals?\b/i,
  /\bowner[- ](?:requests?|questions?|decisions?)\b/i,
  /\bworkflow[- ](?:control|supervision)\b/i,
  /\brunning\/scheduled work\b/i,
] as const;

export type RenderedCompletionEvidenceTask = {
  title: string | null;
  area: string | null;
  summary: string | null;
  taskClass: string | null;
  body: string;
};

function extractTaskSection(raw: string, heading: string): string | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(
    new RegExp(`^## ${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"),
  );
  if (!match) return null;
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}

function getDeliverableSections(raw: string): string {
  return [
    extractTaskSection(raw, "Desired Outcome") ?? "",
    extractTaskSection(raw, "Done When") ?? "",
  ].join("\n");
}

function getConcreteEvidenceSections(raw: string): string {
  return CONCRETE_RENDERED_EVIDENCE_SECTIONS
    .map((heading) => extractTaskSection(raw, heading) ?? "")
    .join("\n");
}

function stripCodeFence(section: string): string {
  const match = section.match(/^\s*```[\w]*\n([\s\S]*?)\n```/);
  return match ? match[1] : section;
}

function isConcreteRuntimeProbeCommand(command: string): boolean {
  if (/[;&|<>()`$]/.test(command)) return false;
  const parts = command.trim().split(/\s+/);
  if (parts[0] !== "pnpm") return false;
  if (parts[1] === "test") return parts.length === 2;
  return parts[1] === "run" &&
    parts.length === 3 &&
    RUNTIME_PROBE_SCRIPT_RE.test(parts[2] ?? "");
}

function hasRuntimeProbeDeclaration(raw: string): boolean {
  const section = extractTaskSection(raw, "Runtime Probe");
  if (!section) return false;
  const body = stripCodeFence(section);
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^command:\s*(.+)$/);
    if (!match) continue;
    return isConcreteRuntimeProbeCommand(match[1]);
  }
  return false;
}

export function declaresRenderedEvidence(raw: string): boolean {
  const text = getDeliverableSections(raw);
  return RENDERED_EVIDENCE_DECLARATION_KEYWORDS.some((pattern) => pattern.test(text));
}

export function hasNamedRenderedEvidence(raw: string): boolean {
  if (hasRuntimeProbeDeclaration(raw)) return true;
  const section = extractTaskSection(raw, "Acceptance Evidence");
  if (!section) return false;
  return ACCEPTED_RENDERED_EVIDENCE_KEYWORDS.some((pattern) => pattern.test(section));
}

function normalizeEvidencePath(candidate: string): string | null {
  const trimmed = candidate
    .trim()
    .replace(/^[("'[]+/, "")
    .replace(/[)"'\],.;:]+$/, "");
  if (!trimmed.includes("/")) return null;
  if (/[<>*$]/.test(trimmed)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  return trimmed.length > 0 ? trimmed : null;
}

function extractEvidencePathReferences(text: string): string[] {
  const paths = new Set<string>();

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const path = normalizeEvidencePath(match[1] ?? "");
    if (path) paths.add(path);
  }

  for (const match of text.matchAll(
    /(?:^|[\s(:])((?:\.{1,2}\/|\.kota\/|[A-Za-z0-9_-]+\/)[^\s`<>]+(?:\/|(?:\.(?:gif|html|jpeg|jpg|json|md|mov|mp4|png|txt|webm|webp|zip))))/g,
  )) {
    const path = normalizeEvidencePath(match[1] ?? "");
    if (path) paths.add(path);
  }

  return [...paths];
}

function resolveEvidencePath(projectDir: string, evidencePath: string): string | null {
  const absolute = isAbsolute(evidencePath)
    ? resolve(evidencePath)
    : resolve(projectDir, evidencePath);
  const rel = relative(projectDir, absolute);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return absolute;
}

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

function directoryContainsRenderedProof(path: string, depth = 0): boolean {
  if (depth > MAX_RENDERED_EVIDENCE_SCAN_DEPTH) return false;
  let entries: Dirent[];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    const childPath = join(path, entry.name);
    if (entry.isFile() && fileLooksLikeRenderedProof(childPath)) return true;
    if (entry.isDirectory() && directoryContainsRenderedProof(childPath, depth + 1)) {
      return true;
    }
  }
  return false;
}

function pathContainsRenderedProof(path: string): boolean {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(path);
  } catch {
    return false;
  }
  if (stats.isFile()) return fileLooksLikeRenderedProof(path);
  if (stats.isDirectory()) return directoryContainsRenderedProof(path);
  return false;
}

export function hasConcreteRenderedEvidenceReference(raw: string): boolean {
  if (hasRuntimeProbeDeclaration(raw)) return true;
  const evidenceText = getConcreteEvidenceSections(raw);
  if (!ACCEPTED_RENDERED_EVIDENCE_KEYWORDS.some((pattern) => pattern.test(evidenceText))) {
    return false;
  }
  return extractEvidencePathReferences(evidenceText).length > 0;
}

export function hasConcreteRenderedEvidence(raw: string, projectDir: string): boolean {
  if (hasRuntimeProbeDeclaration(raw)) return true;
  const evidenceText = getConcreteEvidenceSections(raw);
  if (!ACCEPTED_RENDERED_EVIDENCE_KEYWORDS.some((pattern) => pattern.test(evidenceText))) {
    return false;
  }

  return extractEvidencePathReferences(evidenceText).some((evidencePath) => {
    const resolved = resolveEvidencePath(projectDir, evidencePath);
    return resolved !== null && pathContainsRenderedProof(resolved);
  });
}

function hasOperatorClientArea(area: string | null): boolean {
  return CLIENT_CHANNEL_AREAS.has((area ?? "").trim().toLowerCase());
}

function hasOperatorClientSurfaceKeyword(task: RenderedCompletionEvidenceTask): boolean {
  const text = [
    task.title ?? "",
    task.area ?? "",
    task.summary ?? "",
    task.body,
  ].join("\n");
  return OPERATOR_CLIENT_SURFACE_KEYWORDS.some((pattern) => pattern.test(text));
}

export function requiresRenderedCompletionEvidence(
  task: RenderedCompletionEvidenceTask,
): boolean {
  if (task.taskClass === "Product") {
    return hasOperatorClientArea(task.area) || hasOperatorClientSurfaceKeyword(task);
  }

  return declaresRenderedEvidence(task.body) &&
    (hasOperatorClientArea(task.area) || hasOperatorClientSurfaceKeyword(task));
}
