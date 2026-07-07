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

export function declaresRenderedEvidence(raw: string): boolean {
  const text = getDeliverableSections(raw);
  return RENDERED_EVIDENCE_DECLARATION_KEYWORDS.some((pattern) => pattern.test(text));
}

export function hasNamedRenderedEvidence(raw: string): boolean {
  const section = extractTaskSection(raw, "Acceptance Evidence");
  if (!section) return false;
  return ACCEPTED_RENDERED_EVIDENCE_KEYWORDS.some((pattern) => pattern.test(section));
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
