import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { splitFrontMatter } from "#core/util/frontmatter.js";
import {
  getRepoTaskStateDir,
  REPO_TASK_STATES,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { extractResourceUrls, listResearchRetryCandidates } from "./candidates.js";
import { isPlaywrightAvailable, readBrowserConfig } from "./runtime-detect.js";

export type ResearchRetryUrlClass = "x-post" | "js-rendered" | "plain-http";

const X_POST_RE = /^https?:\/\/(?:www\.)?x\.com\/[^/]+\/status\/\d+/i;
const JS_RENDERED_HOSTS_RE = /^https?:\/\/(?:www\.)?openai\.com\/index\//i;

/**
 * Classify a research URL by the browser-module tool that owns it. The
 * classification is what determines which capability preconditions the
 * workflow needs to be able to read the URL freshly.
 */
export function classifyResourceUrl(url: string): ResearchRetryUrlClass {
  if (X_POST_RE.test(url)) return "x-post";
  if (JS_RENDERED_HOSTS_RE.test(url)) return "js-rendered";
  return "plain-http";
}

export type ResearchRetryCapability = {
  playwrightAvailable: boolean;
  authProfileConfigured: boolean;
  authProfileExists: boolean;
};

/**
 * Inspect the runtime preconditions research-retry depends on: whether
 * Playwright resolves and whether the operator has wired up an auth-profile
 * `storageStatePath` whose file actually exists on disk. Reads the project's
 * `modules.browser` config layer directly so the workflow does not need a
 * hard runtime dependency on the browser module — the browser module owns
 * the actual capability, this function just mirrors the contract closely
 * enough to know when to skip.
 */
export function checkResearchRetryCapability(
  projectDir: string,
): ResearchRetryCapability {
  const playwrightAvailable = isPlaywrightAvailable();
  const browserConfig = readBrowserConfig(projectDir);
  const path =
    typeof browserConfig.storageStatePath === "string" &&
    browserConfig.storageStatePath.length > 0
      ? browserConfig.storageStatePath
      : null;
  if (!path) {
    return {
      playwrightAvailable,
      authProfileConfigured: false,
      authProfileExists: false,
    };
  }
  const resolved = isAbsolute(path) ? path : resolve(projectDir, path);
  return {
    playwrightAvailable,
    authProfileConfigured: true,
    authProfileExists: existsSync(resolved),
  };
}

export function isUrlReadable(
  url: string,
  capability: ResearchRetryCapability,
): boolean {
  switch (classifyResourceUrl(url)) {
    case "plain-http":
      return true;
    case "js-rendered":
      return capability.playwrightAvailable;
    case "x-post":
      return capability.playwrightAvailable && capability.authProfileExists;
  }
}

/**
 * Stable short fingerprint of a candidate's URL set. Used to detect "every
 * candidate URL has already been re-confirmed inaccessible since the task
 * last changed" — when the fingerprint matches a marker the workflow
 * previously wrote into the task body, the URL set is unchanged.
 */
export function computeResourceFingerprint(urls: readonly string[]): string {
  const normalized = urls
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .sort();
  return createHash("sha256").update(normalized.join("\n")).digest("hex").slice(0, 16);
}

const MARKER_RE =
  /<!--\s*research-retry-attempt:\s*fingerprint=([0-9a-f]{16})\s+attempted_at=([^\s>]+)\s*-->/;

export type ResearchRetryMarker = {
  fingerprint: string;
  attemptedAt: string;
};

export function readRetryMarker(taskBody: string): ResearchRetryMarker | null {
  const match = taskBody.match(MARKER_RE);
  return match ? { fingerprint: match[1], attemptedAt: match[2] } : null;
}

export function renderRetryMarker(marker: ResearchRetryMarker): string {
  return `<!-- research-retry-attempt: fingerprint=${marker.fingerprint} attempted_at=${marker.attemptedAt} -->`;
}

export function upsertRetryMarker(
  taskBody: string,
  marker: ResearchRetryMarker,
): string {
  const rendered = renderRetryMarker(marker);
  if (MARKER_RE.test(taskBody)) {
    return taskBody.replace(MARKER_RE, rendered);
  }
  const trimmed = taskBody.replace(/\n+$/, "");
  return `${trimmed}\n\n${rendered}\n`;
}

export type ResearchRetrySkipReason =
  | { kind: "capability-absent"; classes: ResearchRetryUrlClass[] }
  | { kind: "no-change-since-last-attempt"; fingerprint: string };

export type CandidateEvaluationInput = {
  urls: string[];
  body: string;
  capability: ResearchRetryCapability;
};

export type CandidateEvaluation = {
  fingerprint: string;
  marker: ResearchRetryMarker | null;
  skipReason: ResearchRetrySkipReason | null;
};

export type ResearchRetryAvailability = {
  candidateCount: number;
  attemptableCount: number;
};

export function inspectResearchRetryAvailability(
  projectDir: string,
): ResearchRetryAvailability {
  const capability = checkResearchRetryCapability(projectDir);
  const candidates = listResearchRetryCandidates(projectDir);
  let attemptableCount = 0;
  for (const candidate of candidates) {
    const evaluation = evaluateCandidate({
      urls: candidate.urls,
      body: candidate.body,
      capability,
    });
    if (evaluation.skipReason === null) {
      attemptableCount += 1;
    }
  }
  return { candidateCount: candidates.length, attemptableCount };
}

export function evaluateCandidate(
  input: CandidateEvaluationInput,
): CandidateEvaluation {
  const { urls, body, capability } = input;
  const fingerprint = computeResourceFingerprint(urls);
  const marker = readRetryMarker(body);
  const readable = urls.filter((u) => isUrlReadable(u, capability));
  if (readable.length === 0) {
    const classes = Array.from(
      new Set(urls.map((u) => classifyResourceUrl(u))),
    );
    return {
      fingerprint,
      marker,
      skipReason: { kind: "capability-absent", classes },
    };
  }
  if (marker && marker.fingerprint === fingerprint) {
    return {
      fingerprint,
      marker,
      skipReason: { kind: "no-change-since-last-attempt", fingerprint },
    };
  }
  return { fingerprint, marker, skipReason: null };
}

export type MarkAttemptResult =
  | { written: false; reason: string }
  | {
      written: true;
      fingerprint: string;
      attemptedAt: string;
      path: string;
    };

/**
 * Re-read the candidate's task file from `blocked/` after the agent has run,
 * compute a fresh fingerprint of the URLs that remain in `## Resources`, and
 * write (or refresh) the attempt marker in the body. The marker is the
 * workflow's "this URL set was just re-confirmed" record — when the next
 * cycle's fingerprint matches, the agent step is skipped.
 *
 * Side effects:
 * - Edits the task file in place when the task is still in `blocked/`.
 * - No-op (returns `written: false`) when the task moved to another state,
 *   when the file disappeared, or when no resource URLs remain.
 */
export function writeMarkerForCandidate(args: {
  projectDir: string;
  candidateId: string;
  attemptedAt?: string;
}): MarkAttemptResult {
  const { projectDir, candidateId } = args;
  const attemptedAt = args.attemptedAt ?? new Date().toISOString();

  const located = locateTaskFile(projectDir, candidateId);
  if (!located) return { written: false, reason: "task file not found" };
  if (located.state !== "blocked") {
    return { written: false, reason: `task moved to ${located.state}` };
  }

  const content = readFileSync(located.path, "utf8");
  const split = splitFrontMatter(content);
  if (!split) {
    return { written: false, reason: "task file has no frontmatter" };
  }
  const urls = extractResourceUrls(split.body);
  if (urls.length === 0) {
    return { written: false, reason: "no resource URLs remain" };
  }

  const fingerprint = computeResourceFingerprint(urls);
  const newBody = upsertRetryMarker(split.body, { fingerprint, attemptedAt });
  if (newBody === split.body) {
    return { written: false, reason: "marker already current" };
  }
  const rebuilt = `---\n${split.frontmatter}\n---\n${newBody}`;
  writeFileSync(located.path, rebuilt);

  return {
    written: true,
    fingerprint,
    attemptedAt,
    path: relative(projectDir, located.path),
  };
}

function locateTaskFile(
  projectDir: string,
  candidateId: string,
): { state: RepoTaskState; path: string } | null {
  for (const state of REPO_TASK_STATES) {
    const path = join(getRepoTaskStateDir(projectDir, state), `${candidateId}.md`);
    if (existsSync(path)) return { state, path };
  }
  return null;
}
