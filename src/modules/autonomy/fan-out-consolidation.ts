/**
 * Fan-out consolidation review seeding.
 *
 * After a capability ships across multiple client surfaces, autonomy was
 * landing parity commits with green per-surface tests but no holistic check
 * on information architecture, contract consistency, duplicated rendering
 * logic, runtime evidence, or accepted critic warnings. Per-task acceptance
 * could not detect that the surface family had drifted out of coherence
 * because the question only makes sense across the batch.
 *
 * This module is the deterministic queue-shaping mechanism that turns a
 * completed multi-client fan-out batch into a concrete consolidation review
 * task. It is intentionally pure code — agents do not decide whether a batch
 * is consolidation-ready, they receive the seeded task and execute it.
 *
 * The seeded task itself is `area: client` so the rendered-evidence
 * validator gate fires: a critic that accepts only per-surface unit tests
 * will fail because the consolidation's `## Acceptance Evidence` requires
 * rendered/runtime artifacts that span the surface family.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { classifyTaskShape } from "#modules/autonomy/report/task-classification.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  listFullRepoTasks,
  REPO_TASK_STATES,
  type RepoTaskFullRecord,
  type RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export const FAN_OUT_CONSOLIDATION_TASK_PREFIX = "task-fan-out-consolidation-";

/** Default rolling window for "recently shipped" fan-out closures. */
export const DEFAULT_FAN_OUT_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

/** Minimum number of distinct client/channel surfaces required to trigger consolidation. */
export const DEFAULT_MIN_SURFACES = 3;

/**
 * Client/channel surface markers recognized by the detector. Order matters
 * only for stable test output; matching itself is not order-dependent.
 */
export const FAN_OUT_SURFACES = [
  "macos",
  "ios",
  "mobile",
  "web",
  "telegram",
  "slack",
  "cli",
  "daemon",
] as const;

export type FanOutSurface = (typeof FAN_OUT_SURFACES)[number];

const SURFACE_PATTERNS: { surface: FanOutSurface; pattern: RegExp }[] = [
  { surface: "macos", pattern: /\b(?:macos|menu[\s-]?bar|swiftui)\b/i },
  { surface: "ios", pattern: /\b(?:ios|iphone|ipad)\b/i },
  { surface: "mobile", pattern: /\b(?:mobile|react native|expo|[A-Z][a-z]+Screen)\b/ },
  { surface: "web", pattern: /\b(?:web (?:ui|panel|dashboard|client|app)|webpanel|[A-Z][a-z]+Panel)\b/ },
  { surface: "telegram", pattern: /\btelegram\b/i },
  { surface: "slack", pattern: /\bslack\b/i },
  { surface: "cli", pattern: /\b(?:cli|kota [a-z][\w-]*\s+(?:command|subcommand))\b/i },
  { surface: "daemon", pattern: /\b(?:daemon|http endpoint|\/api\/[a-z][\w-]*)\b/i },
];

/**
 * A surface marker can fire on a task touching multiple client surfaces, but
 * we only count a surface once per task to avoid inflating coverage. Returns
 * the set of surfaces present in the title/summary.
 */
function detectSurfaces(title: string, summary: string): Set<FanOutSurface> {
  const text = `${title}\n${summary}`;
  const result = new Set<FanOutSurface>();
  for (const { surface, pattern } of SURFACE_PATTERNS) {
    if (pattern.test(text)) result.add(surface);
  }
  return result;
}

/**
 * Extract a normalized capability key from a task title and summary. The
 * key is the noun shared across the fan-out batch (e.g. `retract`, `answer`,
 * `recall`). We pull from four overlapping surfaces:
 *
 *   - slash-command names (`/retract`, `/answer-log`)
 *   - daemon client method calls (`DaemonClient.retract`)
 *   - client component classes (`RetractPanel`, `AnswerView`)
 *   - prose seam mentions (`cross-store retract seam`, `answer-history seam`)
 *
 * Returns the most frequent candidate; ties broken by length. Returns null
 * when no strong capability noun is found, in which case the task is not
 * grouped into a fan-out batch.
 */
export function extractCapabilityKey(title: string, summary: string): string | null {
  const text = `${title}\n${summary}`;
  const candidates: string[] = [];

  for (const match of text.matchAll(/(?<![A-Za-z])\/([a-z][a-z0-9]*)(?:[-_/<\s.]|$)/gi)) {
    const token = match[1].toLowerCase();
    if (!isStopWord(token)) candidates.push(token);
  }
  for (const match of text.matchAll(/DaemonClient\.([a-z][a-zA-Z0-9]+)/g)) {
    const token = camelToHead(match[1]);
    if (!isStopWord(token)) candidates.push(token);
  }
  for (const match of text.matchAll(
    /\b([A-Z][a-z]+(?:[A-Z][a-z]+)?)(Panel|Screen|View|Form|Page|Modal|Picker|Surface)\b/g,
  )) {
    const token = camelToHead(match[1]);
    if (!isStopWord(token)) candidates.push(token);
  }
  for (const match of text.matchAll(
    /(?:cross-store|on-demand|cross-client|new)\s+([a-z][a-z0-9-]*)\s+(?:seam|surface|capability)/gi,
  )) {
    const token = match[1].toLowerCase().split("-")[0];
    if (!isStopWord(token)) candidates.push(token);
  }
  for (const match of text.matchAll(/\/api\/([a-z][a-z0-9-]*)/g)) {
    const token = match[1].toLowerCase().split("-")[0];
    if (!isStopWord(token)) candidates.push(token);
  }

  if (candidates.length === 0) return null;
  const counts = new Map<string, number>();
  for (const token of candidates) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]),
  );
  return sorted[0][0];
}

const CAPABILITY_STOP_WORDS: ReadonlySet<string> = new Set([
  "api",
  "command",
  "commands",
  "cli",
  "daemon",
  "macos",
  "ios",
  "mobile",
  "web",
  "telegram",
  "slack",
  "main",
  "menu",
  "bar",
  "kota",
  "screen",
  "panel",
  "view",
  "page",
  "form",
  "modal",
  "picker",
  "the",
  "and",
  "for",
  "with",
  "client",
  "channel",
]);

function isStopWord(token: string): boolean {
  return CAPABILITY_STOP_WORDS.has(token) || token.length < 3;
}

function camelToHead(s: string): string {
  return s.replace(/[A-Z]/g, (c, i) => (i === 0 ? c.toLowerCase() : `-${c.toLowerCase()}`)).split("-")[0];
}

export type FanOutBatchSurfaceEntry = {
  surface: FanOutSurface;
  taskId: string;
  title: string;
  closedAt: string;
};

export type FanOutBatch = {
  capabilityKey: string;
  surfaces: FanOutBatchSurfaceEntry[];
  earliestClosedAt: string;
  latestClosedAt: string;
};

export type DetectFanOutOptions = {
  windowMs?: number;
  minSurfaces?: number;
  /** Wall-clock cutoff for the rolling window. Required so tests are deterministic. */
  nowMs: number;
};

/**
 * Detect completed multi-client fan-out batches from done-task records.
 * Pure: takes a snapshot of records and returns batches.
 */
export function detectFanOutBatches(
  records: readonly RepoTaskFullRecord[],
  options: DetectFanOutOptions,
): FanOutBatch[] {
  const windowMs = options.windowMs ?? DEFAULT_FAN_OUT_WINDOW_MS;
  const minSurfaces = options.minSurfaces ?? DEFAULT_MIN_SURFACES;
  const cutoff = options.nowMs - windowMs;

  type Entry = FanOutBatchSurfaceEntry & { capability: string };
  const grouped = new Map<string, Entry[]>();

  for (const record of records) {
    if (record.state !== "done") continue;
    const closedMs = Date.parse(record.updatedAt);
    if (Number.isNaN(closedMs) || closedMs < cutoff || closedMs > options.nowMs) continue;

    const classification = classifyTaskShape({
      area: record.area,
      title: record.title,
      summary: record.summary,
    });
    if (classification !== "fan-out") continue;

    const surfaces = detectSurfaces(record.title, record.summary);
    if (surfaces.size === 0) continue;

    const capability = extractCapabilityKey(record.title, record.summary);
    if (!capability) continue;

    for (const surface of surfaces) {
      const list = grouped.get(capability) ?? [];
      list.push({
        capability,
        surface,
        taskId: record.id,
        title: record.title,
        closedAt: record.updatedAt,
      });
      grouped.set(capability, list);
    }
  }

  const batches: FanOutBatch[] = [];
  for (const [capability, entries] of grouped) {
    const distinctSurfaces = new Set(entries.map((e) => e.surface));
    if (distinctSurfaces.size < minSurfaces) continue;
    const sorted = entries.slice().sort(
      (a, b) => Date.parse(a.closedAt) - Date.parse(b.closedAt) || a.taskId.localeCompare(b.taskId),
    );
    batches.push({
      capabilityKey: capability,
      surfaces: sorted.map(({ capability: _c, ...rest }) => rest),
      earliestClosedAt: sorted[0].closedAt,
      latestClosedAt: sorted[sorted.length - 1].closedAt,
    });
  }

  return batches.sort(
    (a, b) =>
      Date.parse(b.latestClosedAt) - Date.parse(a.latestClosedAt) ||
      a.capabilityKey.localeCompare(b.capabilityKey),
  );
}

export function consolidationTaskIdForCapability(capabilityKey: string): string {
  return `${FAN_OUT_CONSOLIDATION_TASK_PREFIX}${capabilityKey}`;
}

/**
 * Idempotency: a consolidation task for a capability exists in any state,
 * so a re-detection of the same batch must not re-seed.
 */
export function findExistingConsolidationTaskState(
  projectDir: string,
  capabilityKey: string,
): RepoTaskState | null {
  const tasksDir = getRepoTasksDir(projectDir);
  const taskId = consolidationTaskIdForCapability(capabilityKey);
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${taskId}.md`);
    if (existsSync(candidate)) return state;
  }
  return null;
}

export type ConsolidationProposal =
  | {
      action: "noop";
      capabilityKey: string;
      reason: string;
      existingState: RepoTaskState;
    }
  | {
      action: "create";
      capabilityKey: string;
      taskId: string;
      target: "ready";
      batch: FanOutBatch;
    };

/**
 * For each detected batch, propose whether to seed a new consolidation task
 * or skip because one already exists.
 */
export function proposeConsolidationActions(
  projectDir: string,
  batches: readonly FanOutBatch[],
): ConsolidationProposal[] {
  const proposals: ConsolidationProposal[] = [];
  for (const batch of batches) {
    const existing = findExistingConsolidationTaskState(projectDir, batch.capabilityKey);
    if (existing) {
      proposals.push({
        action: "noop",
        capabilityKey: batch.capabilityKey,
        reason: `consolidation task ${consolidationTaskIdForCapability(batch.capabilityKey)} already exists in ${existing}/`,
        existingState: existing,
      });
      continue;
    }
    proposals.push({
      action: "create",
      capabilityKey: batch.capabilityKey,
      taskId: consolidationTaskIdForCapability(batch.capabilityKey),
      target: "ready",
      batch,
    });
  }
  return proposals;
}

export type ConsolidationApplied =
  | { kind: "noop"; capabilityKey: string; reason: string; existingState: RepoTaskState }
  | { kind: "created"; capabilityKey: string; taskId: string; path: string };

export type ApplyConsolidationContext = {
  projectDir: string;
  /** Stable timestamp for both task body and frontmatter `created_at`/`updated_at`. */
  nowIso: string;
};

export function applyConsolidationProposal(
  proposal: ConsolidationProposal,
  ctx: ApplyConsolidationContext,
): ConsolidationApplied {
  if (proposal.action === "noop") {
    return {
      kind: "noop",
      capabilityKey: proposal.capabilityKey,
      reason: proposal.reason,
      existingState: proposal.existingState,
    };
  }

  const targetDir = getRepoTaskStateDir(ctx.projectDir, "ready");
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `${proposal.taskId}.md`);
  if (existsSync(targetPath)) {
    throw new Error(
      `fan-out-consolidation: target file already exists at ${targetPath} but proposer said no existing task — disk state changed mid-run`,
    );
  }
  writeFileSync(
    targetPath,
    buildConsolidationTaskFile(proposal.taskId, proposal.batch, ctx.nowIso),
    "utf-8",
  );
  execFileSync("git", ["add", targetPath], { cwd: ctx.projectDir });
  return {
    kind: "created",
    capabilityKey: proposal.capabilityKey,
    taskId: proposal.taskId,
    path: targetPath.slice(ctx.projectDir.length + 1),
  };
}

export function buildConsolidationTaskFile(
  taskId: string,
  batch: FanOutBatch,
  nowIso: string,
): string {
  const attrs: Record<string, string> = {
    id: taskId,
    title: `Consolidate ${batch.capabilityKey} surfaces across clients`,
    status: "ready",
    priority: "p2",
    area: "client",
    summary:
      `Review the ${batch.capabilityKey} surface family across ` +
      `${[...new Set(batch.surfaces.map((s) => s.surface))].join(", ")} ` +
      "for IA, contract consistency, duplicated rendering, runtime evidence, " +
      "and accepted critic warnings now that the multi-client fan-out has shipped.",
    created_at: nowIso,
    updated_at: nowIso,
  };
  return serializeFlatFrontMatter(attrs, buildConsolidationTaskBody(batch));
}

/**
 * Render the consolidation task body. Required check headings are present in
 * `## Done When` so a reviewer can see at a glance which dimensions must be
 * inspected. `## Acceptance Evidence` names rendered/runtime artifact kinds
 * so the rendered-evidence validator gate (which fires for `area: client`
 * tasks declaring rendered evidence in `## Done When`) cannot be cleared by
 * prose-only test logs.
 */
export function buildConsolidationTaskBody(batch: FanOutBatch): string {
  const distinctSurfaces = [...new Set(batch.surfaces.map((s) => s.surface))].sort();
  const surfaceList = distinctSurfaces.map((s) => `- ${s}`).join("\n");
  const evidenceList = batch.surfaces
    .map((s) => `- ${s.taskId} (${s.surface}, closed ${s.closedAt}) — ${s.title}`)
    .join("\n");

  const lines: string[] = [
    "",
    "## Problem",
    "",
    `The \`${batch.capabilityKey}\` capability shipped across ${distinctSurfaces.length} client surfaces`,
    `(${distinctSurfaces.join(", ")}) without a holistic check on whether the surface family stayed coherent.`,
    "Per-surface tests passed, but coherence questions only make sense across the batch:",
    "operator workflow fit, cross-client contract consistency, duplicated route/error/rendering",
    "logic, provider readiness, runtime evidence, and accepted critic trade-offs.",
    "",
    "## Multi-client fan-out batch",
    "",
    `Capability: \`${batch.capabilityKey}\``,
    "",
    "Surfaces shipped:",
    "",
    surfaceList,
    "",
    "Recently closed fan-out tasks in this batch:",
    "",
    evidenceList,
    "",
    "## Desired Outcome",
    "",
    `The \`${batch.capabilityKey}\` surface family is reviewed end-to-end and either confirmed coherent`,
    "or has follow-up tasks opened for each gap. Concretely, the review produces:",
    "",
    "- a written verdict for each consolidation dimension below;",
    "- rendered evidence (screenshots, screencasts, transcripts, or runtime probes) showing the",
    "  surface family from an operator's perspective, not only per-surface unit logs;",
    "- follow-up task ids for any duplicated rendering, missing contract conformance, stale",
    "  legacy affordance, or unaddressed accepted critic warning surfaced during review.",
    "",
    "## Constraints",
    "",
    "- Do not silently \"fix\" a surface during this review. The output is a verdict and",
    "  follow-up tasks; substantive changes belong in the follow-up tasks themselves.",
    "- Per-surface unit test logs do not satisfy this review. The acceptance evidence must",
    "  show the family from an operator's vantage point.",
    "- Do not add a parallel cross-client docs catalog. Update scoped `AGENTS.md` near the",
    "  surfaces being reviewed when conventions need adjustment.",
    "- A consolidation task does not block future fan-out. Open follow-up tasks for gaps",
    "  rather than freezing the queue.",
    "",
    "## Done When",
    "",
    `1. **Information architecture.** The \`${batch.capabilityKey}\` capability is discoverable from`,
    "   each surface's primary navigation/menu without overloading other entries.",
    "2. **Cross-client capability contract.** All client surfaces speak the same daemon contract",
    "   (request shape, discriminated result arms, error codes, unavailable-state codes).",
    "3. **Duplicated route/error/rendering logic.** Any duplicate decoder, error renderer, or",
    "   provider-readiness probe across clients is named, with a follow-up task to fold it.",
    "4. **Provider readiness and unavailable state.** Each surface degrades gracefully when the",
    "   underlying provider is unavailable, surfacing the daemon's typed failure code.",
    "5. **Live runtime/screenshot/transcript evidence.** A rendered artifact (screenshot,",
    "   screencast, snapshot fixture, or runtime probe) per surface proves the surface family",
    "   is coherent end-to-end, not only that per-surface tests pass.",
    "6. **Stale legacy affordances.** Older surface affordances superseded by this fan-out are",
    "   either removed or filed as removal tasks.",
    "7. **Docs/AGENTS reality check.** Scoped `AGENTS.md` files near the reviewed surfaces",
    "   describe what shipped; stale lines are pruned in the same change.",
    "8. **Accepted critic warning review.** Any compatibility shim, baseline-only ratchet, or",
    "   text-only visual proof previously accepted by a critic on these fan-out commits is",
    "   either retired or has a follow-up task naming the retirement plan.",
    "",
    "## Source / Intent",
    "",
    `Auto-seeded by the fan-out-consolidator workflow after the \`${batch.capabilityKey}\` capability`,
    `landed across ${distinctSurfaces.length} client surfaces between ${batch.earliestClosedAt}`,
    `and ${batch.latestClosedAt}. The 2026-04-28 broad daemon review found that fan-out batches`,
    "without a holistic consolidation pass left an overloaded operator surface despite green",
    "per-surface tests. This task is the autonomy queue's recurring corrective pass.",
    "",
    "## Initiative",
    "",
    "Autonomy quality control: fan-out should end in a coherent product surface, not just a",
    "checklist of parity commits. Each capability gets one consolidation review per shipped",
    "fan-out batch, and the review's output is operator-actionable follow-up tasks.",
    "",
    "## Acceptance Evidence",
    "",
    "- Rendered screenshots or screencasts (one per client surface) committed under a run",
    "  directory or as snapshot fixtures, demonstrating the consolidated surface family.",
    "- A transcript or runtime probe artifact showing each surface respects the same daemon",
    "  contract (matching arms for the same request).",
    "- A list of follow-up task ids opened for each consolidation finding, or a written note",
    "  stating no follow-up was needed and why.",
    "- Updated scoped `AGENTS.md` lines reflecting any convention adjustments arising from",
    "  the review.",
    "",
  ];
  return lines.join("\n");
}

export type FanOutConsolidationArtifact = {
  generatedAt: string;
  detection: {
    windowMs: number;
    minSurfaces: number;
    nowMs: number;
  };
  batches: FanOutBatch[];
  proposals: ConsolidationProposal[];
  applied: ConsolidationApplied[];
};

export type SeedFanOutConsolidationOptions = {
  projectDir: string;
  nowMs: number;
  nowIso: string;
  windowMs?: number;
  minSurfaces?: number;
};

export type SeedFanOutConsolidationResult = {
  artifact: FanOutConsolidationArtifact;
  /** True when at least one new consolidation task was written to disk. */
  touchedDisk: boolean;
};

/**
 * End-to-end seeding orchestration. Reads done tasks from the repo, detects
 * fan-out batches, and applies any non-noop proposals. Returns the artifact
 * shape so the workflow step can write it to the run directory and decide
 * whether to commit.
 */
export function seedFanOutConsolidationTasks(
  options: SeedFanOutConsolidationOptions,
): SeedFanOutConsolidationResult {
  const records = listFullRepoTasks(options.projectDir, ["done"]);
  const batches = detectFanOutBatches(records, {
    windowMs: options.windowMs,
    minSurfaces: options.minSurfaces,
    nowMs: options.nowMs,
  });
  const proposals = proposeConsolidationActions(options.projectDir, batches);
  const applied: ConsolidationApplied[] = [];
  let touchedDisk = false;
  for (const proposal of proposals) {
    const result = applyConsolidationProposal(proposal, {
      projectDir: options.projectDir,
      nowIso: options.nowIso,
    });
    applied.push(result);
    if (result.kind === "created") touchedDisk = true;
  }
  const artifact: FanOutConsolidationArtifact = {
    generatedAt: options.nowIso,
    detection: {
      windowMs: options.windowMs ?? DEFAULT_FAN_OUT_WINDOW_MS,
      minSurfaces: options.minSurfaces ?? DEFAULT_MIN_SURFACES,
      nowMs: options.nowMs,
    },
    batches,
    proposals,
    applied,
  };
  return { artifact, touchedDisk };
}
