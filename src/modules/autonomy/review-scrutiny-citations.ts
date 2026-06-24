const FILE_LINE_CITATION_PATTERN = /\b[\w./-]+\.[A-Za-z0-9]+(?::\d+|#L\d+)\b/g;

export function fileLineCitationsInText(text: string): string[] {
  const matches = text.match(FILE_LINE_CITATION_PATTERN);
  return matches ? [...new Set(matches)] : [];
}

export function countFileLineCitations(text: string): number {
  return fileLineCitationsInText(text).length;
}

export function normalizeFileLineCitations(citations: readonly string[]): string[] {
  return [...new Set(citations.flatMap((citation) => fileLineCitationsInText(citation)))];
}

function diffFilePath(rawPath: string): string | null {
  const path = rawPath.trim().split(/\s/, 1)[0];
  if (!path || path === "/dev/null") return null;
  return path.startsWith("b/") ? path.slice(2) : path;
}

export function fileLineCitationsFromUnifiedDiff(
  diffContent: string,
  limit = 5,
): string[] {
  const citations: string[] = [];
  const seen = new Set<string>();
  let currentFile: string | null = null;

  for (const line of diffContent.split("\n")) {
    if (line.startsWith("+++ ")) {
      currentFile = diffFilePath(line.slice(4));
      continue;
    }

    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    const lineText = hunk?.[1];
    if (!currentFile || !lineText) continue;

    const lineNumber = Number(lineText);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;

    const citation = `${currentFile}:${lineNumber}`;
    if (seen.has(citation)) continue;
    seen.add(citation);
    citations.push(citation);
    if (citations.length >= limit) return citations;
  }

  return citations;
}
