export const TASK_SOURCE_INTENT_PLACEHOLDER =
  "Preserve the owner request, inbox capture, research source, or runtime evidence that caused this task. Keep urgency and product intent intact.";

export const TASK_INITIATIVE_PLACEHOLDER =
  "Name the broader product, architecture, or autonomy outcome this task advances. For p3 maintenance, write `N/A - scoped maintenance`.";

export const TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER =
  "- Describe the command, artifact, transcript, screenshot, fixture, or demo that will prove the task is actually done.";

function extractRepoTaskSection(raw: string, heading: string): string | null {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(
    new RegExp(`^## ${escapedHeading}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m"),
  );
  if (!match) return null;
  const body = match[1].trim();
  return body.length > 0 ? body : null;
}

export function hasConcreteTaskAcceptanceEvidence(raw: string): boolean {
  const section = extractRepoTaskSection(raw, "Acceptance Evidence");
  if (!section) return false;
  if (section.includes(TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER)) return false;
  return /(?:^|\n)\s*-\s+\S/.test(section) ||
    /\b(?:transcript|screenshot|fixture|test|command|artifact|validation|demo|snapshot)\b/i.test(
      section,
    );
}

export function hasProductSafetyTaskLink(raw: string): boolean {
  const section = extractRepoTaskSection(raw, "Product / Safety Link");
  if (!section || section.replace(/[-*\s]/g, "").length < 12) return false;
  return /\b(?:Product|Safety|task-[a-z0-9-]+)\b/i.test(section);
}

export const INDEXABLE_TASK_SECTIONS = [
  "Problem",
  "Desired Outcome",
  "Constraints",
  "Source / Intent",
  "Initiative",
] as const;

export function extractTaskSections(
  body: string,
  headings: readonly string[],
): Record<string, string> {
  const wanted = new Set(headings);
  const lines = body.split(/\r?\n/);
  const result: Record<string, string> = {};
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentHeading) result[currentHeading] = buffer.join("\n").trim();
    buffer = [];
    currentHeading = null;
  };
  for (const line of lines) {
    const match = /^##\s+(.+)\s*$/.exec(line);
    if (match) {
      flush();
      const heading = match[1].trim();
      if (wanted.has(heading)) currentHeading = heading;
      continue;
    }
    if (currentHeading) buffer.push(line);
  }
  flush();
  return result;
}

export function buildIndexableTaskText(record: {
  title: string;
  summary: string;
  body: string;
}): string {
  const parts: string[] = [];
  if (record.title) parts.push(record.title);
  if (record.summary) parts.push(record.summary);
  const sections = extractTaskSections(record.body, INDEXABLE_TASK_SECTIONS);
  for (const heading of INDEXABLE_TASK_SECTIONS) {
    const body = sections[heading];
    if (body) parts.push(body.trim());
  }
  return parts.join("\n\n").trim();
}
