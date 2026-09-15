import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import type { ResolvedScopePolicy } from "#core/daemon/scope-policy.js";
import { decideScopePolicy } from "#core/daemon/scope-policy-decisions.js";
import { getToolEffect } from "#core/tools/index.js";
import { getModuleToolEffectMetadata } from "#core/tools/tool-effect-registry.js";
import { splitFrontMatter } from "#core/util/frontmatter.js";
import { isRunLocalEffect } from "#core/workflow/transaction-effect-policy.js";
import {
  REPO_TASK_STATES,
  type RepoTaskFullRecord,
  type RepoTaskState,
  readVerifiedRepoTaskFile,
  writeRepoTaskFile,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { extractResourceUrls, listResearchRetryCandidates } from "./candidates.js";
import { isPlaywrightAvailable, readBrowserConfig } from "./runtime-detect.js";

export type ResearchRetryUrlClass = "x-post" | "js-rendered" | "plain-http";
export type ResearchSourceTool = "web_fetch" | "rendered_article_read" | "x_post_read";

export function researchSourceTool(url: string): ResearchSourceTool {
  const kind = classifyResourceUrl(url);
  return kind === "x-post" ? "x_post_read" : kind === "js-rendered" ? "rendered_article_read" : "web_fetch";
}

/** Resolve on the host, before crossing into the registry-free inspection worker. */
export function availableResearchSourceTools(policy: ResolvedScopePolicy | undefined): ResearchSourceTool[] {
  if (!policy) return [];
  const tools: ResearchSourceTool[] = ["web_fetch", "rendered_article_read", "x_post_read"];
  return tools.filter((name) => {
    const moduleName = getModuleToolEffectMetadata(name)?.moduleName;
    if (moduleName && (policy.modules.overrides.find((entry) => entry.moduleName === moduleName)?.availability ??
      policy.modules.defaultAvailability) !== "enabled") return false;
    const effect = getToolEffect(name);
    return effect !== undefined && isRunLocalEffect(effect) &&
      decideScopePolicy(policy, {
        kind: "tool-effect", toolName: name, effectKind: effect.kind, effectScope: effect.scope,
      }).outcome === "allow";
  });
}

const X_POST_RE = /^https?:\/\/(?:(?:www|mobile)\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i;
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
  availableTools: readonly ResearchSourceTool[];
  playwrightAvailable: boolean;
  authProfileConfigured: boolean;
  authProfileExists: boolean;
  authProfileRevision: string | null;
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
  workspaceRoot: string,
  availableTools: readonly ResearchSourceTool[],
): ResearchRetryCapability {
  const playwrightAvailable = isPlaywrightAvailable();
  const browserConfig = readBrowserConfig(workspaceRoot);
  const path =
    typeof browserConfig.storageStatePath === "string" &&
    browserConfig.storageStatePath.length > 0
      ? browserConfig.storageStatePath
      : null;
  if (!path) {
    return {
      availableTools,
      playwrightAvailable,
      authProfileConfigured: false,
      authProfileExists: false,
      authProfileRevision: null,
    };
  }
  const resolved = isAbsolute(path) ? path : resolve(workspaceRoot, path);
  const profile = statSync(resolved, { throwIfNoEntry: false });
  return {
    availableTools,
    playwrightAvailable,
    authProfileConfigured: true,
    authProfileExists: profile?.isFile() ?? false,
    // Detect refreshed credentials without reading or exposing their contents.
    authProfileRevision: profile?.isFile()
      ? computeResourceFingerprint([resolved, `${profile.dev}:${profile.ino}:${profile.size}:${profile.mtimeMs}:${profile.ctimeMs}`])
      : null,
  };
}

export function isUrlReadable(
  url: string,
  capability: ResearchRetryCapability,
): boolean {
  if (!capability.availableTools.includes(researchSourceTool(url))) return false;
  switch (classifyResourceUrl(url)) {
    case "plain-http":
      return true;
    case "js-rendered":
      return capability.playwrightAvailable;
    case "x-post":
      return capability.playwrightAvailable && capability.authProfileExists;
  }
}

/** Diagnostic identity; retry eligibility is per source and access state. */
export function computeResourceFingerprint(urls: readonly string[]): string {
  const normalized = urls
    .map((u) => u.trim())
    .filter((u) => u.length > 0)
    .sort();
  return createHash("sha256").update(normalized.join("\n")).digest("hex").slice(0, 16);
}

const MARKER_RE = /<!--\s*research-retry-attempt:\s*([\s\S]*?)\s*-->/g;
export const SOURCE_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const researchSourceAttemptSchema = z.object({
  url: z.url(),
  accessFingerprint: z.string(),
  attemptedAt: z.iso.datetime(),
  tools: z.array(z.enum(["web_fetch", "rendered_article_read", "x_post_read"])).min(1),
  outcome: z.enum(["readable", "unavailable"]),
});
const retryMarkerSchema = z.object({
  fingerprint: z.string(),
  attemptedAt: z.iso.datetime(),
  attempts: z.array(researchSourceAttemptSchema),
});
export type ResearchSourceAttempt = z.infer<typeof researchSourceAttemptSchema>;
export type ResearchRetryMarker = z.infer<typeof retryMarkerSchema>;

export function sourceAccessFingerprint(
  url: string,
  capability: ResearchRetryCapability,
  tools?: ResearchSourceAttempt["tools"],
): string {
  const kind = classifyResourceUrl(url);
  const usedBrowser = tools?.some((tool) => tool !== "web_fetch") ?? kind !== "plain-http";
  const access = usedBrowser ? capability : { playwrightAvailable: capability.playwrightAvailable };
  return computeResourceFingerprint([kind, JSON.stringify(access)]);
}

export function readRetryMarker(taskBody: string): ResearchRetryMarker | null {
  const match = [...taskBody.matchAll(MARKER_RE)].at(-1);
  if (!match) return null;
  try {
    const parsed = retryMarkerSchema.safeParse(JSON.parse(match[1]!));
    return parsed.success ? parsed.data : null;
  } catch {
    // Legacy URL-set markers prove no individual source attempt.
    return null;
  }
}

export function renderRetryMarker(marker: ResearchRetryMarker): string {
  return `<!-- research-retry-attempt: ${JSON.stringify(marker).replace(/</g, "\\u003c").replace(/>/g, "\\u003e")} -->`;
}

export function upsertRetryMarker(
  taskBody: string,
  marker: ResearchRetryMarker,
): string {
  const rendered = renderRetryMarker(marker);
  const trimmed = taskBody.replace(MARKER_RE, "").replace(/\n+$/, "");
  return `${trimmed}\n\n${rendered}\n`;
}

export type ResearchRetrySkipReason =
  | { kind: "capability-absent"; classes: ResearchRetryUrlClass[] }
  | { kind: "no-change-since-last-attempt"; fingerprint: string };

export type CandidateEvaluationInput = {
  urls: string[];
  body: string;
  capability: ResearchRetryCapability;
  now?: number;
};

export type CandidateEvaluation = {
  fingerprint: string;
  marker: ResearchRetryMarker | null;
  skipReason: ResearchRetrySkipReason | null;
  attemptableUrls: string[];
};

export type ResearchRetryAvailability = {
  candidateCount: number;
  attemptableCount: number;
};

export function inspectResearchRetryAvailability(
  workspaceRoot: string,
  availableTools: readonly ResearchSourceTool[],
  tasks?: readonly RepoTaskFullRecord[],
): ResearchRetryAvailability {
  const capability = checkResearchRetryCapability(workspaceRoot, availableTools);
  const candidates = listResearchRetryCandidates(workspaceRoot, tasks);
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
      attemptableUrls: [],
      skipReason: { kind: "capability-absent", classes },
    };
  }
  const now = input.now ?? Date.now();
  const attemptableUrls = readable.filter((url) => {
    const attempt = marker?.attempts.find((entry) => entry.url === url);
    if (!attempt || attempt.accessFingerprint !== sourceAccessFingerprint(url, capability, attempt.tools)) return true;
    const age = now - Date.parse(attempt.attemptedAt);
    return age < 0 || age >= SOURCE_RETRY_INTERVAL_MS;
  });
  if (attemptableUrls.length === 0) {
    return {
      fingerprint,
      marker,
      attemptableUrls,
      skipReason: { kind: "no-change-since-last-attempt", fingerprint },
    };
  }
  return { fingerprint, marker, attemptableUrls, skipReason: null };
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
 * Re-read the blocked candidate's task file from `data/tasks/` after the agent has run,
 * retain only actual workflow source attempts for URLs still pending.
 * Newly added or unattempted URLs never inherit another source's marker.
 *
 * Side effects:
 * - Edits the task file in place when the task still has `status: blocked`.
 * - No-op (returns `written: false`) when the task moved to another state,
 *   when the file disappeared, or when no resource URLs remain.
 */
export function writeMarkerForCandidate(args: {
  workspaceRoot: string;
  candidateId: string;
  attempts: ResearchSourceAttempt[];
}): MarkAttemptResult {
  const { workspaceRoot, candidateId } = args;

  const located = locateTaskFile(workspaceRoot, candidateId);
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
  const recorded = z.array(researchSourceAttemptSchema).parse(args.attempts)
    .filter((attempt) => urls.includes(attempt.url));
  if (recorded.length === 0) return { written: false, reason: "no attempted sources remain" };
  const attempts = [...new Map([
    ...(readRetryMarker(split.body)?.attempts ?? []),
    ...recorded,
  ].filter((attempt) => urls.includes(attempt.url)).map((attempt) => [attempt.url, attempt])).values()];
  const attemptedAt = recorded.map((attempt) => attempt.attemptedAt).sort().at(-1)!;
  const newBody = upsertRetryMarker(split.body, { fingerprint, attemptedAt, attempts });
  if (newBody === split.body) {
    return { written: false, reason: "marker already current" };
  }
  const rebuilt = `---\n${split.frontmatter}\n---\n${newBody}`;
  writeRepoTaskFile(workspaceRoot, located.path, rebuilt);

  return {
    written: true,
    fingerprint,
    attemptedAt,
    path: relative(workspaceRoot, located.path),
  };
}

function locateTaskFile(
  workspaceRoot: string,
  candidateId: string,
): { state: RepoTaskState; path: string } | null {
  for (const state of REPO_TASK_STATES) {
    const verified = readVerifiedRepoTaskFile(workspaceRoot, state, candidateId);
    if (verified) return { state, path: join(workspaceRoot, verified.path) };
  }
  return null;
}
