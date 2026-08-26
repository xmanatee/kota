export const INDEXABLE_TASK_SECTIONS = [
  "Problem",
  "Desired Outcome",
  "Constraints",
  "How We Will Know",
  // Older tasks remain searchable without making their headings a contract.
  "Done When",
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
