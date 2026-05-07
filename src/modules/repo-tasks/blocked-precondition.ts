import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { getRepoTaskStateDir } from "./repo-tasks-domain.js";

/**
 * Typed unblock-precondition vocabulary for tasks in `data/tasks/blocked/`.
 *
 * Each blocked task declares one precondition in a `## Unblock Precondition`
 * body section using fixed-key syntax. The autonomy `blocked-promoter`
 * workflow reads the parsed precondition each cycle: deterministic kinds
 * auto-promote the task back to `backlog/` (or `ready/` for p0/p1) when the
 * condition is satisfied; `owner-decision` gets re-asked through the
 * `askOwnerSteps` recipe on a 14-day cadence; `operator-capture` promotes
 * only after its named evidence path exists, and its aging is surfaced through
 * `attention-digest` while the evidence is absent.
 *
 * The vocabulary is intentionally small. The parser rejects unknown kinds and
 * malformed values at frontmatter-load time; there is no permissive coercion.
 */
export type BlockedPrecondition =
  | TaskDonePrecondition
  | CapabilityInstalledPrecondition
  | OwnerDecisionPrecondition
  | OperatorCapturePrecondition;

export type BlockedPreconditionKind = BlockedPrecondition["kind"];

export type TaskDonePrecondition = {
  kind: "task-done";
  /** Task id of the enabler that must sit in `data/tasks/done/`. */
  ref: string;
};

export type CapabilityInstalledPrecondition = {
  kind: "capability-installed";
  /**
   * Named probe that the autonomy runtime can evaluate deterministically
   * against repo state alone (no network). Recognized probes:
   *
   * - `playwright` — the `playwright` package is resolvable.
   * - `storageState:<path>` — the file at the given repo-relative or
   *   absolute path exists. The path follows the colon and may contain
   *   slashes; whitespace is trimmed.
   */
  probe: string;
};

export type OwnerDecisionPrecondition = {
  kind: "owner-decision";
  /**
   * Stable slot identifier the autonomy loop uses to track ask cadence.
   * Different blocked tasks may re-ask the same slot if the answer
   * unblocks more than one task; in practice, slots are 1:1 with tasks
   * today.
   */
  slot: string;
  /** Human-readable question the workflow re-asks the owner. */
  question: string;
  /** Optional context paragraph the workflow includes with the question. */
  context: string | null;
  /**
   * Optional comma-separated list of suggested answers shown alongside the
   * question. The promoter recognizes a literal `unblock` answer as the
   * approval signal for promoting the task; everything else only refreshes
   * the ask marker.
   */
  proposedAnswers: string[];
};

export type OperatorCapturePrecondition = {
  kind: "operator-capture";
  /**
   * Repo-relative path that must exist for the precondition to fire. May be
   * a literal file/directory path, or a glob containing `*` characters;
   * globs are matched against immediate children of the parent directory.
   */
  path: string;
  /** One-line description shown in attention-digest aging entries. */
  description: string;
};

export type BlockedPreconditionParseResult =
  | { ok: true; precondition: BlockedPrecondition }
  | { ok: false; error: string };

const SECTION_HEADING = "## Unblock Precondition";
const RECOGNIZED_KINDS: BlockedPreconditionKind[] = [
  "task-done",
  "capability-installed",
  "owner-decision",
  "operator-capture",
];

/**
 * Extract the raw `key: value` block from inside the `## Unblock Precondition`
 * section. The block may be wrapped in a fenced code block (```...```) so the
 * markdown renders cleanly. Returns null when the section is absent so the
 * caller can decide whether absence is an error in this context.
 */
function extractPreconditionBlock(body: string): string | null {
  const idx = body.indexOf(SECTION_HEADING);
  if (idx === -1) return null;
  const after = body.slice(idx + SECTION_HEADING.length);
  // Stop at the next `## ` heading or end of body.
  const nextSection = after.search(/\n##\s/);
  const sectionBody = nextSection === -1 ? after : after.slice(0, nextSection);
  const stripped = sectionBody.replace(/```[a-zA-Z]*\n?|```/g, "").trim();
  return stripped;
}

function parseKeyValueBlock(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("<!--")) continue;
    const colon = trimmed.indexOf(":");
    if (colon < 1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    fields[key] = value;
  }
  return fields;
}

function parseProposedAnswers(raw: string | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  return raw.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

const TASK_ID_RE = /^task-[a-z0-9-]+$/;
const SLOT_RE = /^[a-z0-9][a-z0-9-]*$/;
const PROBE_PLAYWRIGHT = /^playwright$/;
const PROBE_STORAGE_STATE = /^storageState:.+$/;

function buildPrecondition(
  fields: Record<string, string>,
): BlockedPreconditionParseResult {
  const kind = fields.kind;
  if (!kind) return { ok: false, error: "missing required field 'kind'" };
  if (!RECOGNIZED_KINDS.includes(kind as BlockedPreconditionKind)) {
    return {
      ok: false,
      error: `unknown precondition kind '${kind}' (recognized: ${RECOGNIZED_KINDS.join(", ")})`,
    };
  }
  switch (kind as BlockedPreconditionKind) {
    case "task-done": {
      const ref = fields.ref;
      if (!ref) return { ok: false, error: "task-done precondition requires 'ref'" };
      if (!TASK_ID_RE.test(ref)) {
        return {
          ok: false,
          error: `task-done 'ref' must match ${TASK_ID_RE.source}, got '${ref}'`,
        };
      }
      return { ok: true, precondition: { kind: "task-done", ref } };
    }
    case "capability-installed": {
      const probe = fields.probe;
      if (!probe) return { ok: false, error: "capability-installed precondition requires 'probe'" };
      if (!PROBE_PLAYWRIGHT.test(probe) && !PROBE_STORAGE_STATE.test(probe)) {
        return {
          ok: false,
          error: `capability-installed 'probe' must be 'playwright' or 'storageState:<path>', got '${probe}'`,
        };
      }
      return { ok: true, precondition: { kind: "capability-installed", probe } };
    }
    case "owner-decision": {
      const slot = fields.slot;
      const question = fields.question;
      if (!slot) return { ok: false, error: "owner-decision precondition requires 'slot'" };
      if (!SLOT_RE.test(slot)) {
        return {
          ok: false,
          error: `owner-decision 'slot' must match ${SLOT_RE.source}, got '${slot}'`,
        };
      }
      if (!question || question.length === 0) {
        return { ok: false, error: "owner-decision precondition requires 'question'" };
      }
      // Mirror the askOwner review gate's structural contract at parse time so
      // a malformed question fails task validation instead of crashing
      // blocked-promoter at the ask step. Keep this in sync with
      // src/core/daemon/owner-question-review.ts.
      if (!question.endsWith("?")) {
        return {
          ok: false,
          error:
            "owner-decision 'question' must end with '?' so the askOwner review gate accepts it; move trailing context into the 'context' field",
        };
      }
      return {
        ok: true,
        precondition: {
          kind: "owner-decision",
          slot,
          question,
          context: fields.context && fields.context.length > 0 ? fields.context : null,
          proposedAnswers: parseProposedAnswers(fields.proposed_answers),
        },
      };
    }
    case "operator-capture": {
      const path = fields.path;
      const description = fields.description;
      if (!path) return { ok: false, error: "operator-capture precondition requires 'path'" };
      if (!description || description.length === 0) {
        return { ok: false, error: "operator-capture precondition requires 'description'" };
      }
      return { ok: true, precondition: { kind: "operator-capture", path, description } };
    }
  }
}

/**
 * Parse the `## Unblock Precondition` section out of a blocked task's body.
 *
 * - `{ ok: false, error: "missing-section" }` when the section is absent.
 * - `{ ok: false, error: <reason> }` when the section is malformed or
 *   declares an unknown kind / probe.
 * - `{ ok: true, precondition }` on success.
 */
export function parseBlockedPrecondition(
  body: string,
): BlockedPreconditionParseResult {
  const block = extractPreconditionBlock(body);
  if (block === null) return { ok: false, error: "missing-section" };
  if (block.length === 0) {
    return { ok: false, error: "## Unblock Precondition section is empty" };
  }
  return buildPrecondition(parseKeyValueBlock(block));
}

const requireFromHere = createRequire(import.meta.url);

function isPlaywrightAvailable(projectDir: string): boolean {
  // Try resolving relative to the project first (the operator's installed
  // copy), then fall back to the repo-local resolver. Either resolves the
  // capability for the autonomy loop's purposes.
  try {
    const projectRequire = createRequire(join(projectDir, "package.json"));
    projectRequire.resolve("playwright");
    return true;
  } catch {
    // fall through
  }
  try {
    requireFromHere.resolve("playwright");
    return true;
  } catch {
    return false;
  }
}

function fileExists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function pathMatchesGlob(projectDir: string, glob: string): boolean {
  const star = glob.indexOf("*");
  if (star === -1) {
    const absolute = isAbsolute(glob) ? glob : resolve(projectDir, glob);
    return fileExists(absolute);
  }
  const before = glob.slice(0, star);
  const after = glob.slice(star + 1);
  const baseSlash = before.lastIndexOf("/");
  const baseDirRel = baseSlash === -1 ? "" : before.slice(0, baseSlash);
  const prefix = baseSlash === -1 ? before : before.slice(baseSlash + 1);
  const suffix = after;
  const baseDir = isAbsolute(baseDirRel) ? baseDirRel : resolve(projectDir, baseDirRel);
  if (!existsSync(baseDir)) return false;
  let entries: string[];
  try {
    entries = readdirSync(baseDir);
  } catch {
    return false;
  }
  return entries.some((entry) => entry.startsWith(prefix) && entry.endsWith(suffix));
}

export type BlockedPreconditionEvaluation =
  | { satisfied: true; reason: string }
  | { satisfied: false; reason: string };

export type OwnerAskMarker = {
  slot: string;
  lastAskedAt: string;
};

const ASK_MARKER_RE =
  /<!--\s*blocked-promoter-asked:\s*slot=([a-z0-9-]+)\s+last_asked_at=([^\s>]+)\s*-->/g;

export function readOwnerAskMarkers(body: string): OwnerAskMarker[] {
  const markers: OwnerAskMarker[] = [];
  for (const match of body.matchAll(ASK_MARKER_RE)) {
    markers.push({ slot: match[1], lastAskedAt: match[2] });
  }
  return markers;
}

export function renderOwnerAskMarker(marker: OwnerAskMarker): string {
  return `<!-- blocked-promoter-asked: slot=${marker.slot} last_asked_at=${marker.lastAskedAt} -->`;
}

export function upsertOwnerAskMarker(body: string, marker: OwnerAskMarker): string {
  const slotRe = new RegExp(
    `<!--\\s*blocked-promoter-asked:\\s*slot=${marker.slot}\\s+last_asked_at=[^\\s>]+\\s*-->`,
    "g",
  );
  if (slotRe.test(body)) {
    return body.replace(slotRe, renderOwnerAskMarker(marker));
  }
  const trimmed = body.replace(/\n+$/, "");
  return `${trimmed}\n\n${renderOwnerAskMarker(marker)}\n`;
}

const RESOLVED_MARKER_RE =
  /<!--\s*blocked-promoter-resolved:\s*slot=([a-z0-9-]+)\s+resolved_at=([^\s>]+)\s*-->/;

export type OwnerResolvedMarker = {
  slot: string;
  resolvedAt: string;
};

export function readOwnerResolvedMarker(body: string): OwnerResolvedMarker | null {
  const match = body.match(RESOLVED_MARKER_RE);
  return match ? { slot: match[1], resolvedAt: match[2] } : null;
}

export function renderOwnerResolvedMarker(marker: OwnerResolvedMarker): string {
  return `<!-- blocked-promoter-resolved: slot=${marker.slot} resolved_at=${marker.resolvedAt} -->`;
}

/**
 * Per-task marker the `blocked-promoter` writes after surfacing operator-
 * capture instructions for an aged blocker. The marker tracks the cadence so
 * downstream consumers (notably `attention-digest`) can suppress repeated
 * noise about a blocker the workflow has already actioned within the
 * cadence window.
 *
 * Operator-capture preconditions are at most one-per-task today, so the
 * marker carries no slot — the task body itself is the scope.
 */
export type OperatorCaptureInstructedMarker = {
  lastInstructedAt: string;
};

const OPERATOR_CAPTURE_INSTRUCTED_RE =
  /<!--\s*blocked-promoter-operator-capture-instructed:\s*last_instructed_at=([^\s>]+)\s*-->/;

export function readOperatorCaptureInstructedMarker(
  body: string,
): OperatorCaptureInstructedMarker | null {
  const match = body.match(OPERATOR_CAPTURE_INSTRUCTED_RE);
  return match ? { lastInstructedAt: match[1] } : null;
}

export function renderOperatorCaptureInstructedMarker(
  marker: OperatorCaptureInstructedMarker,
): string {
  return `<!-- blocked-promoter-operator-capture-instructed: last_instructed_at=${marker.lastInstructedAt} -->`;
}

const OPERATOR_CAPTURE_INSTRUCTED_GLOBAL_RE =
  /<!--\s*blocked-promoter-operator-capture-instructed:\s*last_instructed_at=[^\s>]+\s*-->/g;

export function upsertOperatorCaptureInstructedMarker(
  body: string,
  marker: OperatorCaptureInstructedMarker,
): string {
  if (OPERATOR_CAPTURE_INSTRUCTED_GLOBAL_RE.test(body)) {
    OPERATOR_CAPTURE_INSTRUCTED_GLOBAL_RE.lastIndex = 0;
    return body.replace(
      OPERATOR_CAPTURE_INSTRUCTED_GLOBAL_RE,
      renderOperatorCaptureInstructedMarker(marker),
    );
  }
  OPERATOR_CAPTURE_INSTRUCTED_GLOBAL_RE.lastIndex = 0;
  const trimmed = body.replace(/\n+$/, "");
  return `${trimmed}\n\n${renderOperatorCaptureInstructedMarker(marker)}\n`;
}

export type EvaluationContext = {
  projectDir: string;
  taskBody: string;
};

/**
 * Evaluate whether a precondition is satisfied right now against repo state.
 *
 * The result is the input the `blocked-promoter` workflow uses to decide
 * whether to auto-promote the task. `owner-decision` never auto-resolves from
 * probe data alone: it requires a matching
 * `<!-- blocked-promoter-resolved -->` marker in the body (written by the
 * workflow when the operator approves). `operator-capture` promotes only when
 * the named path exists.
 */
export function evaluateBlockedPrecondition(
  precondition: BlockedPrecondition,
  ctx: EvaluationContext,
): BlockedPreconditionEvaluation {
  switch (precondition.kind) {
    case "task-done": {
      const path = join(
        getRepoTaskStateDir(ctx.projectDir, "done"),
        `${precondition.ref}.md`,
      );
      if (existsSync(path)) {
        return { satisfied: true, reason: `enabler ${precondition.ref} is in done/` };
      }
      return {
        satisfied: false,
        reason: `enabler ${precondition.ref} is not in done/`,
      };
    }
    case "capability-installed": {
      if (precondition.probe === "playwright") {
        return isPlaywrightAvailable(ctx.projectDir)
          ? { satisfied: true, reason: "playwright is resolvable" }
          : { satisfied: false, reason: "playwright is not installed" };
      }
      const colon = precondition.probe.indexOf(":");
      if (colon === -1) {
        return { satisfied: false, reason: `unknown probe '${precondition.probe}'` };
      }
      const kind = precondition.probe.slice(0, colon);
      const arg = precondition.probe.slice(colon + 1).trim();
      if (kind === "storageState") {
        const absolute = isAbsolute(arg) ? arg : resolve(ctx.projectDir, arg);
        return fileExists(absolute)
          ? { satisfied: true, reason: `storage-state file exists at ${arg}` }
          : { satisfied: false, reason: `storage-state file missing at ${arg}` };
      }
      return { satisfied: false, reason: `unknown probe '${precondition.probe}'` };
    }
    case "owner-decision": {
      const resolved = readOwnerResolvedMarker(ctx.taskBody);
      if (resolved && resolved.slot === precondition.slot) {
        return {
          satisfied: true,
          reason: `owner resolved slot '${precondition.slot}' at ${resolved.resolvedAt}`,
        };
      }
      return {
        satisfied: false,
        reason: `owner has not resolved slot '${precondition.slot}'`,
      };
    }
    case "operator-capture": {
      return pathMatchesGlob(ctx.projectDir, precondition.path)
        ? { satisfied: true, reason: `operator capture exists at ${precondition.path}` }
        : { satisfied: false, reason: `operator capture missing at ${precondition.path}` };
    }
  }
}

/**
 * Auto-promotion target state for a blocked task whose precondition fired.
 * Conservative: the promoter only sends `p0`/`p1` work straight to `ready/`;
 * everything else lands in `backlog/` for normal triage.
 */
export function promotionTargetState(priority: string): "ready" | "backlog" {
  return priority === "p0" || priority === "p1" ? "ready" : "backlog";
}
