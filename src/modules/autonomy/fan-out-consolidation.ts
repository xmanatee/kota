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
 * The seeded task carries the batch evidence and desired operator outcome;
 * the builder and critic decide which proof is sufficient for that outcome.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { classifyTaskShape } from "#modules/autonomy/report/task-classification.js";
import { renderRepoTaskIntent } from "#modules/repo-tasks/repo-task-intent.js";
import {
  getRepoTaskStateDir,
  getRepoTasksDir,
  listFullRepoTasks,
  REPO_TASK_STATES,
  type RepoTaskFullRecord,
  type RepoTaskState,
  writeRepoTaskFile,
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

const PRIMARY_SURFACE_PATTERNS: { surface: FanOutSurface; pattern: RegExp }[] = [
  { surface: "slack", pattern: /\bslack(?:[- ]?channel)?\b/i },
  { surface: "telegram", pattern: /\btelegram\b/i },
  { surface: "macos", pattern: /\b(?:macos|menu[\s-]?bar|swiftui)\b/i },
  { surface: "ios", pattern: /\b(?:ios|iphone|ipad)\b/i },
  { surface: "mobile", pattern: /\b(?:mobile|react native|expo|[A-Z][a-z]+(?:[A-Z][a-z]+)?Screen)\b/ },
  { surface: "web", pattern: /\b(?:web (?:ui|panel|dashboard|client|app)|webpanel|[A-Z][a-z]+(?:[A-Z][a-z]+)?Panel)\b/ },
  { surface: "cli", pattern: /\b(?:cli|kota [a-z][\w-]*\s+(?:command|subcommand))\b/i },
  { surface: "daemon", pattern: /\b(?:daemon http|http endpoint|\/api\/[a-z][\w-]*)\b/i },
];

/**
 * A completed fan-out task represents one shipped surface. Its title or
 * summary may mention peer surfaces through shared seams (`DaemonClient.*`,
 * `/api/*`, "cross-store", copied Done When text), but those mentions are
 * context, not additional shipped surfaces. Counting every marker inflated
 * batches and produced bogus consolidation records, so the detector now
 * assigns at most one primary surface per task.
 */
export function detectPrimarySurface(title: string, summary: string): FanOutSurface | null {
  const text = title.trim().length > 0 ? title : summary;
  for (const { surface, pattern } of PRIMARY_SURFACE_PATTERNS) {
    if (pattern.test(text)) return surface;
  }
  return null;
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
  const titleCapability = extractCapabilityCandidate(title);
  if (titleCapability) return titleCapability;
  return extractCapabilityCandidate(summary);
}

function extractCapabilityCandidate(text: string): string | null {
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

    const surface = detectPrimarySurface(record.title, record.summary);
    if (!surface) continue;

    const capability = extractCapabilityKey(record.title, record.summary);
    if (!capability) continue;

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
  const targetPath = join(targetDir, `${proposal.taskId}.md`);
  if (existsSync(targetPath)) {
    throw new Error(
      `fan-out-consolidation: target file already exists at ${targetPath} but proposer said no existing task — disk state changed mid-run`,
    );
  }
  writeRepoTaskFile(
    ctx.projectDir,
    targetPath,
    buildConsolidationTaskFile(proposal.taskId, proposal.batch, ctx.nowIso),
  );
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

export function buildConsolidationTaskBody(batch: FanOutBatch): string {
  const distinctSurfaces = [...new Set(batch.surfaces.map((s) => s.surface))].sort();
  const context = [
    `Auto-seeded after \`${batch.capabilityKey}\` landed across ${distinctSurfaces.length} surfaces between ${batch.earliestClosedAt} and ${batch.latestClosedAt}.`,
    "",
    "### Fan-out batch",
    `- Capability: \`${batch.capabilityKey}\``,
    ...distinctSurfaces.map((surface) => `- Surface: ${surface}`),
    ...batch.surfaces.map(
      (surface) =>
        `- Closed task: ${surface.taskId} (${surface.surface}, ${surface.closedAt}) — ${surface.title}`,
    ),
  ].join("\n");

  return renderRepoTaskIntent({
    problem:
      `The \`${batch.capabilityKey}\` capability shipped across ${distinctSurfaces.join(", ")} ` +
      "without a holistic check of operator workflow fit, contract consistency, duplicated client logic, and accepted trade-offs.",
    desiredOutcome:
      "Review the surface family end-to-end, record a verdict for each consolidation dimension, and open a focused follow-up task for every concrete gap or explain why none is needed.",
    constraints: [
      "Keep this task as a review; substantive fixes belong in focused follow-up tasks.",
      "Judge the operator journey, not only per-surface unit logs.",
      "Do not add a parallel cross-client catalog; update scoped guidance when conventions change.",
      "Do not block future fan-out while review findings are being addressed.",
    ],
    doneWhen: [
      `**Information architecture.** The \`${batch.capabilityKey}\` capability is discoverable and coherent on every listed surface.`,
      "**Shared contract.** All surfaces use the same typed daemon request, result, error, and unavailable-state contract.",
      "**Duplication and stale paths.** Duplicate decoders, renderers, readiness probes, and obsolete affordances are removed or have focused follow-up tasks.",
      "**Unavailable states.** Each surface degrades clearly when its provider is unavailable.",
      "**Operator proof.** Operator-facing evidence demonstrates the cross-surface journey.",
      "**Guidance.** Scoped guidance reflects the resulting convention.",
      "**Review disposition.** Accepted critic warnings are resolved, explicitly retained, or assigned a follow-up task.",
    ],
    context,
    acceptanceEvidence: [
      "Operator-facing evidence for each surface in the batch.",
      "A contract-level probe or transcript covering the shared daemon behavior.",
      "Follow-up task ids for findings, or a concrete no-follow-up disposition.",
    ],
  });
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
