import { isAbsolute, relative, resolve } from "node:path";
import { pathContainsRenderedProof } from "./task-rendered-evidence-artifacts.js";
import { isConcreteEvidencePathReference } from "./task-rendered-evidence-paths.js";

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

export function hasConcreteRenderedEvidenceReference(
  raw: string,
  taskId?: string | null,
): boolean {
  if (hasRuntimeProbeDeclaration(raw)) return true;
  const evidenceText = getConcreteEvidenceSections(raw);
  if (!ACCEPTED_RENDERED_EVIDENCE_KEYWORDS.some((pattern) => pattern.test(evidenceText))) {
    return false;
  }
  return extractEvidencePathReferences(evidenceText).some((evidencePath) =>
    isConcreteEvidencePathReference(evidencePath, { taskId })
  );
}

export function hasConcreteRenderedEvidence(
  raw: string,
  projectDir: string,
  taskId?: string | null,
): boolean {
  if (hasRuntimeProbeDeclaration(raw)) return true;
  const evidenceText = getConcreteEvidenceSections(raw);
  if (!ACCEPTED_RENDERED_EVIDENCE_KEYWORDS.some((pattern) => pattern.test(evidenceText))) {
    return false;
  }

  return extractEvidencePathReferences(evidenceText).some((evidencePath) => {
    const resolved = resolveEvidencePath(projectDir, evidencePath);
    return resolved !== null &&
      isConcreteEvidencePathReference(evidencePath, { taskId }) &&
      pathContainsRenderedProof(resolved, projectDir, { taskId });
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
