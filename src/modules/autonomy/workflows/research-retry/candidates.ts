import { listRepoTasksInState } from "#modules/repo-tasks/repo-tasks-domain.js";

/**
 * A blocked research task's retry candidacy. A task qualifies when it is
 * in the `blocked` state and its body contains a `## Resources` section —
 * the convention used by research-area tasks to list URLs the task needs
 * to read. The body is included so the workflow can read its retry-marker
 * fingerprint without a second filesystem round-trip.
 */
export type ResearchRetryCandidate = {
  id: string;
  updatedAt: string;
  urls: string[];
  body: string;
};

const RESOURCES_HEADING_RE = /^##\s+Resources\s*$/m;

/**
 * Extract `http(s)` URLs from the `## Resources` section of a task body.
 * The section runs from the heading to the next `##` heading or end of
 * body. URLs that land inside fenced code blocks are still captured; the
 * intent is a permissive sweep of "URLs the task author listed as needing
 * access" rather than prose-only matching.
 */
export function extractResourceUrls(taskBody: string): string[] {
  const match = taskBody.match(/## Resources([\s\S]*?)(?:\n## |$)/);
  if (!match) return [];
  const section = match[1];
  const urlRe = /https?:\/\/[^\s<>"')\]]+/g;
  const found = section.match(urlRe) ?? [];
  return Array.from(new Set(found.map((u) => u.replace(/[.,;:]+$/, ""))));
}

/**
 * List blocked tasks whose body carries a `## Resources` section of URLs
 * eligible for retry. Sorted by `updatedAt` ascending so the oldest
 * blocker is retried first.
 */
export function listResearchRetryCandidates(projectDir: string): ResearchRetryCandidate[] {
  const blocked = listRepoTasksInState(projectDir, "blocked");
  const candidates: ResearchRetryCandidate[] = [];
  for (const record of blocked) {
    if (!RESOURCES_HEADING_RE.test(record.body)) continue;
    const urls = extractResourceUrls(record.body);
    if (urls.length === 0) continue;
    candidates.push({
      id: record.frontmatter.id,
      updatedAt: record.frontmatter.updatedAt,
      urls,
      body: record.body,
    });
  }
  candidates.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  return candidates;
}
