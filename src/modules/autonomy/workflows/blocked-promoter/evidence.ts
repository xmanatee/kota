import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { type EvidenceJsonObject, projectEvidenceObject } from "#core/evidence/policy.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { readConfinedEvidenceJson } from "#modules/autonomy/evidence-reader.js";

export type BlockedEvidence = {
  artifacts: Array<{ path: string; digest: string; content: EvidenceJsonObject }>;
  unavailable: string[];
};

export function evidenceDigest(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function collectBlockedEvidenceInWorker(input: { scopeRoot: string; hint: string; excludedRunIds: readonly string[] }): BlockedEvidence {
  return collectBlockedEvidence(input.scopeRoot, input.hint, input.excludedRunIds);
}

export const collectBlockedEvidenceOperation = defineWorkflowBlockingOperation<
  Parameters<typeof collectBlockedEvidenceInWorker>[0], BlockedEvidence
>(import.meta.url, "collectBlockedEvidenceInWorker");

/** Capture immutable, redacted snapshots of existing runtime evidence, never host configuration. */
export function collectBlockedEvidence(scopeRoot: string, hint: string, excludedRunIds: readonly string[] = []): BlockedEvidence {
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
  const visit = (path: string, depth: number) => {
    if (excluded.has(path)) return;
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
        const raw = readConfinedEvidenceJson(scopeRoot, relative(scopeRoot, path));
        const content = projectEvidenceObject(raw, "agent-context");
        cohortCounts.set(cohort, count + 1);
        result.artifacts.push({ path: relative(scopeRoot, path), digest: evidenceDigest(content), content });
      }
    } catch (error) {
      const code = error instanceof Error ? ("code" in error ? String(error.code) : error.message) : "invalid evidence";
      result.unavailable.push(`${relative(scopeRoot, path)}: ${code}; absence and host capability are not established`);
    }
  };
  if (requested.includes("*")) {
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
  if (requested === roots[0]) visit(roots[1]!, 0);
  return result;
}
