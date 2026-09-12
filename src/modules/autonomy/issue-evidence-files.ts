import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { projectEvidenceObject } from "#core/evidence/policy.js";
import { moduleFile } from "#core/modules/module-files.js";
import type { FileAccess } from "#core/util/filesystem/anchored-file-protocol.js";
import { readAnchoredTextFiles } from "#core/util/filesystem/anchored-files.js";
import type { WorkflowBlockingOperationContext } from "#core/workflow/blocking-operation.js";
import type { RunStateDatabase } from "#core/workflow/run-state-database.js";
import type { AutonomyHealthEvidenceRef } from "./health-signal.js";

/** Resolve only cited diagnostic files; references never authorize arbitrary host paths. */
export async function collectIssueEvidenceFiles(
  input: { scopeRoot: string; scopeId: string; stateDir: string },
  references: readonly AutonomyHealthEvidenceRef[],
  authority: RunStateDatabase,
  context: WorkflowBlockingOperationContext,
): Promise<object[]> {
  const evidence: object[] = [];
  const files = new Map<string, { access: FileAccess; refs: AutonomyHealthEvidenceRef[]; module?: string }>();
  for (const reference of references) {
    if (reference.kind !== "artifact" && reference.kind !== "module-log") continue;
    const { ref } = reference;
    const runMatch = /^\.kota\/runs\/([A-Za-z0-9][A-Za-z0-9._-]*)\/((?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.json)$/.exec(ref);
    const logMatch = /^\.kota\/modules\/([^/\\\0]+)\/logs\.jsonl(?:#L([1-9][0-9]*))?$/.exec(ref);
    let access: FileAccess;
    let module: string | undefined;
    if (reference.kind === "artifact" && runMatch) {
      const run = authority.getRun(runMatch[1]!);
      if (!run || run.scopeId !== input.scopeId) {
        evidence.push({ ref, unavailable: "Run is unavailable from this scope's runtime evidence" });
        continue;
      }
      const boundaryDir = join(input.stateDir, "runs", run.id);
      access = { rootPath: input.stateDir, boundaryDir, filePath: join(boundaryDir, runMatch[2]!) };
    } else if (reference.kind === "module-log" && logMatch &&
      authority.getScopeRoot(input.scopeId) === resolve(input.scopeRoot)) {
      module = logMatch[1]!;
      try { access = moduleFile(input.scopeRoot, module, "logs.jsonl"); }
      catch { evidence.push({ ref, unavailable: "Invalid module log reference" }); continue; }
    } else {
      evidence.push({ ref, unavailable: "Reference is not an authorized scoped diagnostic file" });
      continue;
    }
    const selected = files.get(access.filePath);
    if (selected) selected.refs.push(reference);
    else files.set(access.filePath, { access, refs: [reference], ...(module ? { module } : {}) });
  }
  const selected = [...files.values()];
  for (let offset = 0; offset < selected.length; offset += 64) {
    context.signal.throwIfAborted();
    const batch = selected.slice(offset, offset + 64);
    const results = await readAnchoredTextFiles(batch.map(({ access }) => ({ ...access, maxBytes: 128 * 1024 })), context.signal);
    for (const [index, result] of results.entries()) {
      const file = batch[index]!;
      for (const reference of file.refs) {
        const { ref } = reference;
        try {
          if (!result.ok || !result.file) throw new Error("Cited diagnostic file is unavailable or exceeds the bounded export");
          const raw = result.file.content;
          const values = file.module === undefined ? [raw] : raw.split(/\r?\n/);
          const line = /#L([1-9][0-9]*)$/.exec(ref)?.[1];
          const records = (line === undefined ? values : [values[Number(line) - 1] ?? ""])
            .filter((value) => value.trim() !== "").map((value) => {
              let parsed: unknown;
              try { parsed = JSON.parse(value); }
              catch { throw new Error("Diagnostic record is not valid JSON"); }
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Diagnostic record must be a JSON object");
              if ("scopeId" in parsed && parsed.scopeId !== input.scopeId) throw new Error("Diagnostic record belongs to another scope");
              if (file.module !== undefined && (!("module" in parsed) || parsed.module !== file.module)) throw new Error("Module log record attribution does not match its reference");
              return projectEvidenceObject(parsed, "agent-context");
            });
          if (records.length === 0) throw new Error("Cited diagnostic content is unavailable");
          const content = file.module === undefined ? records[0]! : records;
          evidence.push({ ref, scopeId: input.scopeId, content,
            digest: createHash("sha256").update(JSON.stringify(content)).digest("hex") });
        } catch (error) {
          evidence.push({ ref, unavailable: error instanceof Error ? error.message : "Diagnostic content unavailable" });
        }
      }
    }
    context.reportProgress(`Exported ${offset + batch.length} of ${selected.length} cited diagnostic files`);
  }
  return evidence;
}
