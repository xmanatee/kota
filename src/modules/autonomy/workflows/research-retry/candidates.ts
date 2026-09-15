import { parseBlockedPrecondition } from "#modules/repo-tasks/blocked-precondition.js";
import { extractTaskSections, listFullRepoTasks, type RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

/**
 * A blocked research task's retry candidacy. A task qualifies when it is
 * in the `blocked` state with a source-access precondition and HTTP URLs.
 * The body carries prior source attempts without another filesystem read.
 */
export type ResearchRetryCandidate = {
  id: string;
  urls: string[];
  body: string;
};

/** Read ordinary Markdown links, autolinks, references, and bare HTTP URLs. */
export function extractResourceUrls(taskBody: string): string[] {
  const body = taskBody.replace(/<!--[\s\S]*?-->/g, "");
  const extract = (text: string): string[] => {
    const found = text.match(/https?:\/\/[^\s<>"'\]]+/g) ?? [];
    return [...new Set(found.flatMap((raw) => {
      let url = raw.replace(/[.,;:!?]+$/, "");
      while (url.endsWith(")") && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0)) {
        url = url.slice(0, -1);
      }
      try {
        return [new URL(url).href];
      } catch {
        return [];
      }
    }))];
  };
  // An explicit pending-source list wins over citations to already-read sources.
  const blockedUrls = extract(extractTaskSections(body, ["Blocked on"])["Blocked on"] ?? "");
  return blockedUrls.length ? blockedUrls : extract(body);
}

/** Source collection cannot resolve owner decisions or implementation work. */
export function listResearchRetryCandidates(
  workspaceRoot: string,
  tasks: readonly RepoTaskFullRecord[] = listFullRepoTasks(workspaceRoot),
): ResearchRetryCandidate[] {
  const blocked = tasks.filter((task) => task.state === "blocked");
  const candidates: ResearchRetryCandidate[] = [];
  for (const record of blocked) {
    const parsed = parseBlockedPrecondition(record.body);
    if (!parsed.ok || parsed.precondition.kind === "owner-decision") continue;
    const urls = extractResourceUrls(record.body);
    if (urls.length === 0) continue;
    candidates.push({
      id: record.id,
      urls,
      body: record.body,
    });
  }
  candidates.sort((a, b) => a.id.localeCompare(b.id));
  return candidates;
}
