import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type EvidenceJsonObject, projectEvidenceObject } from "#core/evidence/policy.js";
import { readAnchoredTextFiles } from "#core/util/filesystem/anchored-files.js";
import type { WorkflowBlockingOperationContext } from "#core/workflow/blocking-operation.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";

export type BlockedEvidence = {
  artifacts: Array<{ path: string; digest: string; content: EvidenceJsonObject }>;
  unavailable: string[];
};

export function evidenceDigest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type EvidenceSelection = { task: { id: string; body: string }; runIds: readonly string[] };
type CollectionInput = {
  scopeRoot: string; hint: string; excludedRunIds: readonly string[];
  selection?: EvidenceSelection;
  authority?: { runtimeStateDir: string; scopeId: string; task: { id: string; body: string }; excludedWorkflow?: string };
};

export async function collectBlockedEvidenceInWorker(input: CollectionInput, context: WorkflowBlockingOperationContext): Promise<BlockedEvidence> {
  let selection = input.selection;
  let unavailable: string | undefined;
  if (input.authority) {
    const { task, runtimeStateDir, scopeId } = input.authority;
    selection = { task, runIds: [] };
    try {
      const store = RunStateDatabase.openReadOnly(runtimeStateDir);
      try {
        const references = evidenceReferences(task);
        const triggerReferences = [task.id, `data/tasks/${task.id}.md`];
        selection.runIds = store.listRunIds(scopeId, undefined, { references, triggerReferences });
        if (input.authority.excludedWorkflow) {
          const excluded = new Set(store.listRunIds(scopeId, undefined, { workflow: input.authority.excludedWorkflow }));
          selection.runIds = selection.runIds.filter((id) => !excluded.has(id));
          input = { ...input, excludedRunIds: [...input.excludedRunIds, ...excluded] };
        }
      } finally { store.close(); }
      context.reportProgress(`Selected ${selection.runIds.length} task-linked runs`);
    } catch {
      unavailable = "Scoped run authority unavailable; only explicitly cited exports can be collected";
    }
  }
  const result = await collectBlockedEvidence(input.scopeRoot, input.hint, input.excludedRunIds, selection, context);
  if (unavailable) result.unavailable.push(unavailable);
  return result;
}

export function evidenceReferences(task: { id: string; body: string }): string[] {
  const tokens = task.body.match(/[A-Za-z0-9.][A-Za-z0-9._/-]*/g) ?? [];
  const citedRuns = tokens.flatMap((token) => {
    const match = /^\.kota\/runs\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/|$)/.exec(token);
    return match ? [match[1]!] : [];
  });
  return [...new Set([task.id, `data/tasks/${task.id}.md`, ...citedRuns, ...tokens.filter((token) =>
    /^[a-z0-9]{6}$/.test(token) || /^\d{4}-\d{2}-\d{2}T/.test(token))])];
}

export const collectBlockedEvidenceOperation = defineWorkflowBlockingOperation<
  Parameters<typeof collectBlockedEvidenceInWorker>[0], BlockedEvidence
>(import.meta.url, "collectBlockedEvidenceInWorker");

/** Capture immutable, redacted snapshots of existing runtime evidence, never host configuration. */
export async function collectBlockedEvidence(scopeRoot: string, hint: string, excludedRunIds: readonly string[] = [], selection?: EvidenceSelection, context?: WorkflowBlockingOperationContext): Promise<BlockedEvidence> {
  const result: BlockedEvidence = { artifacts: [], unavailable: [] };
  const suppliedRoot = resolve(scopeRoot);
  const suppliedHint = resolve(suppliedRoot, hint);
  // The runtime-authorized root may have an OS alias (for example /var on macOS).
  // Resolve that root once; links within its evidence tree remain forbidden.
  try { scopeRoot = realpathSync(suppliedRoot); } catch {
    return { artifacts: [], unavailable: ["Authorized scope root unavailable; host capability is not established"] };
  }
  const roots = [join(scopeRoot, ".kota", "runs"), join(scopeRoot, ".kota", "eval-runs")];
  const requested = resolve(scopeRoot, relative(suppliedRoot, suppliedHint));
  const within = (root: string, path: string) => {
    const child = relative(root, path);
    return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  };
  const owner = roots.find((root) => within(root, requested));
  if (!owner) return { artifacts: [], unavailable: ["Capture hint is outside scoped runtime evidence; use an authorized export"] };
  const excluded = new Set(excludedRunIds.map((id) => join(roots[0]!, id)));
  const cohortCounts = new Map<string, number>();
  const paths = new Set<string>();
  const visit = (path: string, depth: number) => {
    const runRoot = join(roots[0]!, relative(roots[0]!, path).split(sep)[0]!);
    if (within(roots[0]!, path) && excluded.has(runRoot)) return;
    try {
      const stats = lstatSync(path);
      if (stats.isSymbolicLink() || realpathSync(path) !== path) {
        result.unavailable.push(`${relative(scopeRoot, path)}: linked evidence is not exported`);
        return;
      }
      if (stats.isDirectory()) {
        if (depth > 4) {
          result.unavailable.push(`${relative(scopeRoot, path)}: deeper evidence requires a narrower export`);
          return;
        }
        for (const name of readdirSync(path).filter((name) => !name.startsWith(".")).sort().reverse()) visit(join(path, name), depth + 1);
      } else if (stats.isFile() && path.endsWith(".json")) {
        const cohort = relative(scopeRoot, path).split(sep).slice(0, 3).join("/");
        const count = cohortCounts.get(cohort) ?? 0;
        if (stats.size > 128 * 1024 || count >= 200) {
          result.unavailable.push(`${relative(scopeRoot, path)}: evidence exceeds this export; inspect through its owner`);
          return;
        }
        cohortCounts.set(cohort, count + 1);
        paths.add(path);
      }
    } catch (error) {
      const code = error instanceof Error ? ("code" in error ? String(error.code) : error.message) : "invalid evidence";
      result.unavailable.push(`${relative(scopeRoot, path)}: ${code}; absence and host capability are not established`);
    }
  };
  const broad = roots.includes(requested);
  if (broad && selection) {
    const tokens = new Set([selection.task.id, ...(selection.task.body.match(/[A-Za-z0-9.][A-Za-z0-9._/-]*/g) ?? [])]);
    const selected = new Set<string>();
    for (const id of selection.runIds) {
      try { selected.add(join(roots[0]!, validateWorkflowRunId(id, "Evidence selection"))); }
      catch { result.unavailable.push("Invalid task-linked run identity; evidence was not collected"); }
    }
    for (const token of tokens) {
      if (/^\.kota\/(?:eval-runs|runs)\/[^/]+/.test(token)) {
        const path = resolve(scopeRoot, token);
        if (!roots.includes(path) && roots.some((root) => within(root, path))) selected.add(path);
      }
    }
    // Directory names are cheap discovery hints; unrelated leaves stay unopened.
    for (const root of roots) {
      try {
        if (realpathSync(root) !== root) throw new Error("Linked evidence root");
        for (const name of readdirSync(root)) {
          const shortId = name.split("-").at(-1) ?? "";
          if (tokens.has(name) || (shortId.length >= 6 && tokens.has(shortId))) selected.add(join(root, name));
        }
      } catch { result.unavailable.push(`${relative(scopeRoot, root)}: scoped discovery unavailable`); }
    }
    for (const path of selected) visit(path, 0);
    if (selected.size === 0) result.unavailable.push("No task-linked scoped evidence observed; retain task or cited run provenance in an authorized export");
  } else if (requested.includes("*")) {
    const parent = dirname(requested);
    const pattern = basename(requested).split("*");
    if (parent.includes("*") || pattern.length !== 2) {
      result.unavailable.push("Capture hint requires a single filename or directory wildcard");
    } else {
      try {
        if (realpathSync(parent) !== parent) throw new Error("Linked capture parent is not exported");
        const matches = readdirSync(parent).filter((name) => !name.startsWith(".") &&
          name.startsWith(pattern[0]!) && name.endsWith(pattern[1]!)).sort().reverse();
        for (const name of matches) visit(join(parent, name), 0);
        if (matches.length === 0) result.unavailable.push(`${hint}: no matching scoped export observed`);
      } catch {
        result.unavailable.push(`${hint}: scoped capture discovery unavailable; host capability is not established`);
      }
    }
  } else visit(requested, 0);
  // Eval owners return their own artifact locations; the historical runs hint is not exclusive.
  if (requested === roots[0] && !selection) visit(roots[1]!, 0);
  const candidates = [...paths];
  for (let offset = 0; offset < candidates.length; offset += 64) {
    context?.signal.throwIfAborted();
    const batch = candidates.slice(offset, offset + 64);
    const files = await readAnchoredTextFiles(batch.map((filePath) => ({
      rootPath: scopeRoot, boundaryDir: scopeRoot, filePath, maxBytes: 128 * 1024,
    })), context?.signal);
    for (const [index, file] of files.entries()) {
      const path = relative(scopeRoot, batch[index]!);
      try {
        if (!file.ok) throw new Error(file.reason);
        if (file.file === null) throw new Error("Evidence disappeared during collection");
        const raw: unknown = JSON.parse(file.file.content);
        if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Evidence must be a JSON object");
        const content = projectEvidenceObject(raw, "agent-context");
        result.artifacts.push({ path, digest: evidenceDigest(content), content });
      } catch (error) {
        result.unavailable.push(`${path}: ${error instanceof Error ? error.message : "invalid evidence"}; absence and host capability are not established`);
      }
    }
    context?.reportProgress(`Collected ${Math.min(offset + 64, candidates.length)} of ${candidates.length} selected evidence files`);
  }
  return result;
}
