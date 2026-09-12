import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { projectEvidenceObject, redactSensitiveText } from "#core/evidence/policy.js";
import { listAnchoredDirectory, readAnchoredBytes, writeAnchoredBytes, writeAnchoredTextFile } from "#core/util/filesystem/anchored-files.js";
import { defineWorkflowBlockingOperation } from "./blocking-operation.js";
import { validateWorkflowRunId } from "./run-io.js";

const MAX_ASSET_BYTES = 32 * 1024 * 1024;
const MAX_PROJECTION_BYTES = 128 * 1024;
const MAX_ASSETS = 4096;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const projectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available"), ref: z.string(), sha256: digestSchema, bytes: z.number().int().nonnegative(), policy: z.literal("agent-context") }),
  z.object({ status: z.literal("unavailable"), reason: z.string() }),
]);
const entrySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("retained"), source: z.string(), originalRef: z.string(), originalSha256: digestSchema, originalBytes: z.number().int().nonnegative(), projection: projectionSchema }),
  z.object({ status: z.literal("unavailable"), source: z.string(), reason: z.string() }),
]);
export const runArtifactManifestSchema = z.object({
  version: z.literal(1), scopeRoot: z.string(), runId: z.string(), sourceRevision: z.string().nullable(),
  entries: z.array(entrySchema),
});
export type RunArtifactManifest = z.infer<typeof runArtifactManifestSchema>;
export type RunArtifactEntry = RunArtifactManifest["entries"][number];
export type LinkedRunArtifact = { runId: string; manifestSha256: string };
export type RunArtifactHandoff = { manifestRef: string; manifestSha256: string; manifest: RunArtifactManifest; readOnlyPaths: string[] };
export type RetainRunArtifactsInput = {
  scopeRoot: string; runId: string; sourceRevision?: string;
  /** Runtime-selected roots only. These never come from an agent's path strings. */
  roots: Array<{ name: string; path: string; excludeSuffixes?: string[] }>;
};
export const retainRunArtifactsOperation = defineWorkflowBlockingOperation<RetainRunArtifactsInput, RunArtifactHandoff>(import.meta.url, "retainRunArtifacts");

function hash(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function access(scopeRoot: string, ref: string) {
  if (isAbsolute(ref) || ref.split(/[\\/]/).some(part => part === ".." || part === "." || part === "")) throw new Error("Invalid evidence reference");
  return { rootPath: scopeRoot, boundaryDir: scopeRoot, filePath: join(scopeRoot, ref) };
}
function read(scopeRoot: string, ref: string): Buffer | null {
  return readAnchoredBytes({ ...access(scopeRoot, ref), maxBytes: MAX_ASSET_BYTES });
}
function install(scopeRoot: string, ref: string, bytes: Buffer): void {
  const existing = read(scopeRoot, ref);
  if (existing !== null) {
    if (!existing.equals(bytes)) throw new Error(`Retained evidence integrity mismatch: ${ref}`);
    return;
  }
  writeAnchoredBytes({ ...access(scopeRoot, ref), content: bytes, expectation: "missing" });
  if (!read(scopeRoot, ref)?.equals(bytes)) throw new Error(`Retained evidence verification failed: ${ref}`);
}

/** Exact originals remain private. Projections never pretend to be the original. */
function classifyRecord(value: unknown): unknown {
  // Native raw frames have an opaque payload; its shape cannot establish that
  // it contains public outcome evidence. Keep it under the shared raw policy.
  if (typeof value === "object" && value !== null && "type" in value && value.type === "raw") return { raw: value };
  return value;
}

function project(bytes: Buffer, source: string): Buffer | null {
  if (bytes.length > MAX_PROJECTION_BYTES) return null;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text).equals(bytes) || text.includes("\0")) return null;
  let value: unknown;
  if (/\.jsonl$/i.test(source)) {
    const records: unknown[] = text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    value = { records: records.map(classifyRecord) };
  } else if (/\.json$/i.test(source)) {
    const parsed: unknown = JSON.parse(text);
    value = { content: classifyRecord(parsed) };
  } else {
    value = text;
  }
  // Keep filename classification around every format, including parsed records.
  return Buffer.from(JSON.stringify(projectEvidenceObject({ [source]: value }, "agent-context"), null, 2));
}

function retainAsset(input: RetainRunArtifactsInput, source: string, ref: string, prefix: string): RunArtifactEntry {
  const bytes = read(input.scopeRoot, ref);
  if (bytes === null) throw new Error("Selected artifact is absent");
  const originalSha256 = hash(bytes);
  const originalRef = `${prefix}/originals/${originalSha256}`;
  install(input.scopeRoot, originalRef, bytes);
  let projection: z.infer<typeof projectionSchema>;
  try {
    const projected = project(bytes, source);
    if (projected === null || projected.length > MAX_PROJECTION_BYTES) {
      projection = { status: "unavailable", reason: "Exact original retained; binary or over the 128 KiB review projection limit" };
    } else {
      const sha256 = hash(projected);
      const projectedRef = `${prefix}/projections/${sha256}.json`;
      install(input.scopeRoot, projectedRef, projected);
      projection = { status: "available", ref: projectedRef, sha256, bytes: projected.length, policy: "agent-context" };
    }
  } catch (error) {
    // JSON parser messages can quote source bytes that have not passed policy.
    const reason = error instanceof SyntaxError ? "Invalid structured artifact" : redactSensitiveText(error instanceof Error ? error.message : "Projection failed");
    projection = { status: "unavailable", reason: `Exact original retained; review projection unavailable: ${reason}` };
  }
  return { status: "retained", source, originalRef, originalSha256, originalBytes: bytes.length, projection };
}

/** Append-only, content-addressed snapshots in the existing run store. Safe to replay after restart. */
export function retainRunArtifacts(input: RetainRunArtifactsInput): RunArtifactHandoff {
  validateWorkflowRunId(input.runId, "Run artifact retention");
  const scopeRoot = resolve(input.scopeRoot);
  const prefix = `.kota/runs/${input.runId}/evidence`;
  const entries: RunArtifactEntry[] = [];
  let discovered = 0;
  for (const root of input.roots) {
    const rootRef = relative(scopeRoot, resolve(root.path)).split(sep).join("/");
    access(scopeRoot, rootRef);
    if (!/^[a-z][a-z0-9-]*$/.test(root.name)) throw new Error("Invalid artifact root name");
    function visit(ref: string, source: string, depth: number): void {
      if (depth > 32) throw new Error("Artifact directory exceeds depth limit");
      const directory = access(scopeRoot, ref);
      for (const entry of listAnchoredDirectory({ rootPath: scopeRoot, boundaryDir: root.path, directoryPath: directory.filePath })) {
        if (++discovered > MAX_ASSETS) throw new Error("Artifact selection exceeds 4096 entries");
        const childRef = `${ref}/${entry.name}`;
        const childSource = `${source}/${entry.name}`;
        if (entry.kind === "directory") visit(childRef, childSource, depth + 1);
        else {
          if (root.excludeSuffixes?.some(suffix => entry.name.endsWith(suffix))) continue;
          try { entries.push(retainAsset({ ...input, scopeRoot }, childSource, childRef, prefix)); }
          catch (error) { entries.push({ status: "unavailable", source: childSource, reason: redactSensitiveText(error instanceof Error ? error.message : "Artifact unavailable") }); }
        }
      }
    }
    try { visit(rootRef, root.name, 0); }
    catch (error) { entries.push({ status: "unavailable", source: root.name, reason: redactSensitiveText(error instanceof Error ? error.message : "Artifact discovery unavailable") }); }
  }
  const manifest: RunArtifactManifest = { version: 1, scopeRoot, runId: input.runId, sourceRevision: input.sourceRevision ?? null, entries };
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
  const manifestSha256 = hash(bytes);
  const manifestRef = `${prefix}/manifests/${manifestSha256}.json`;
  install(scopeRoot, manifestRef, bytes);
  // The existing run-artifact inspection surface serves top-level Markdown.
  writeAnchoredTextFile({ ...access(scopeRoot, `.kota/runs/${input.runId}/evidence-references.md`), expectation: "any",
    content: `Run evidence snapshot: ${manifestRef}\nSHA-256: ${manifestSha256}\n\n${JSON.stringify(manifest, null, 2)}\n`,
  });
  return resolveRunArtifactHandoff(scopeRoot, { runId: input.runId, manifestSha256 });
}

/** Callers authorize the run first; references then verify scope, content and projection bytes. */
export function resolveRunArtifactHandoff(scopeRoot: string, selected: LinkedRunArtifact): RunArtifactHandoff {
  validateWorkflowRunId(selected.runId, "Run artifact reference");
  digestSchema.parse(selected.manifestSha256);
  const prefix = `.kota/runs/${selected.runId}/evidence`;
  const manifestRef = `${prefix}/manifests/${selected.manifestSha256}.json`;
  const bytes = read(scopeRoot, manifestRef);
  if (!bytes || hash(bytes) !== selected.manifestSha256) throw new Error("Evidence manifest absent or altered");
  const manifest = runArtifactManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (manifest.scopeRoot !== resolve(scopeRoot) || manifest.runId !== selected.runId) throw new Error("Evidence manifest belongs to another scope or run");
  const readOnlyPaths = [join(scopeRoot, manifestRef)];
  for (const entry of manifest.entries) {
    if (entry.status !== "retained") continue;
    if (entry.originalRef !== `${prefix}/originals/${entry.originalSha256}`) throw new Error("Invalid original reference");
    const original = read(scopeRoot, entry.originalRef);
    if (!original || hash(original) !== entry.originalSha256 || original.length !== entry.originalBytes) throw new Error("Original evidence absent or altered");
    if (entry.projection.status !== "available") continue;
    if (entry.projection.ref !== `${prefix}/projections/${entry.projection.sha256}.json`) throw new Error("Invalid projection reference");
    const projected = read(scopeRoot, entry.projection.ref);
    if (!projected || hash(projected) !== entry.projection.sha256 || projected.length !== entry.projection.bytes) throw new Error("Evidence projection absent or altered");
    readOnlyPaths.push(join(scopeRoot, entry.projection.ref));
  }
  return { manifestRef, manifestSha256: selected.manifestSha256, manifest, readOnlyPaths };
}

export function requireRetainedRunArtifacts(input: RetainRunArtifactsInput): void {
  const handoff = retainRunArtifacts(input);
  const unavailable = handoff.manifest.entries.filter(entry => entry.status === "unavailable");
  if (unavailable.length > 0) throw new Error(`Run evidence retention failed: ${JSON.stringify(unavailable)}`);
}

export const resolveRunArtifactHandoffOperation = defineWorkflowBlockingOperation<{ scopeRoot: string; selected: LinkedRunArtifact }, RunArtifactHandoff>(import.meta.url, "resolveRunArtifactHandoffInWorker");
export function resolveRunArtifactHandoffInWorker(input: { scopeRoot: string; selected: LinkedRunArtifact }): RunArtifactHandoff {
  return resolveRunArtifactHandoff(input.scopeRoot, input.selected);
}
