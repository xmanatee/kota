import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  type ProductionReplacementArtifact,
  validateProductionReplacementArtifact,
} from "./production-replacement-evidence.js";
import { runProductionReplacementTests } from "./production-replacement-execution.js";
import {
  PRODUCTION_REPLACEMENT_SECTION,
  type ProductionReplacementDeclaration,
  parseProductionReplacementDeclaration,
} from "./production-replacement-proof.js";

type ResolvedProductionReplacementCompletion =
  | {
    ok: true;
    declaration: ProductionReplacementDeclaration;
    artifact: ProductionReplacementArtifact;
  }
  | { ok: false; error: string };

export type ProductionReplacementCompletionResult =
  | { ok: true; declaration: ProductionReplacementDeclaration }
  | { ok: false; error: string };

function resolveRepoFile(projectDir: string, path: string): string | null {
  const absolute = resolve(projectDir, path);
  const repoRelative = relative(projectDir, absolute);
  if (
    repoRelative.length === 0 ||
    repoRelative === ".." ||
    repoRelative.startsWith("../") ||
    isAbsolute(repoRelative)
  ) return null;
  try {
    const stat = lstatSync(absolute);
    return stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 ? absolute : null;
  } catch {
    return null;
  }
}

function isIndexedRepoFile(projectDir: string, absolutePath: string): boolean {
  const repoRelative = relative(projectDir, absolutePath);
  try {
    execFileSync(
      "git",
      ["ls-files", "--error-unmatch", "--", repoRelative],
      {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    execFileSync(
      "git",
      ["diff", "--quiet", "--", repoRelative],
      {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return true;
  } catch {
    return false;
  }
}

function resolveProductionReplacementCompletion(args: {
  raw: string;
  taskId: string;
  projectDir: string;
}): ResolvedProductionReplacementCompletion {
  const parsed = parseProductionReplacementDeclaration(args.raw);
  if (parsed.kind === "absent") {
    return { ok: false, error: `missing ## ${PRODUCTION_REPLACEMENT_SECTION} section` };
  }
  if (parsed.kind === "invalid") return { ok: false, error: parsed.error };

  for (const testPath of parsed.declaration.productionTests) {
    if (resolveRepoFile(args.projectDir, testPath) === null) {
      return { ok: false, error: `declared production test is missing or unsafe: ${testPath}` };
    }
  }
  for (const entrypointPath of parsed.declaration.productionEntrypoints) {
    if (resolveRepoFile(args.projectDir, entrypointPath) === null) {
      return {
        ok: false,
        error: `declared production entrypoint is missing or unsafe: ${entrypointPath}`,
      };
    }
  }
  const artifactPath = resolveRepoFile(args.projectDir, parsed.declaration.evidenceArtifact);
  if (artifactPath === null) {
    return { ok: false, error: `evidence artifact is missing, empty, unsafe, or symlinked: ${parsed.declaration.evidenceArtifact}` };
  }
  if (!isIndexedRepoFile(args.projectDir, artifactPath)) {
    return {
      ok: false,
      error: `evidence artifact must be tracked or staged with indexed content matching the durable clean-checkout proof: ${parsed.declaration.evidenceArtifact}`,
    };
  }
  let artifact: ProductionReplacementArtifact | null;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, "utf-8")) as ProductionReplacementArtifact;
  } catch (error) {
    return { ok: false, error: `evidence artifact is not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const error = validateProductionReplacementArtifact(
    artifact,
    parsed.declaration,
    args.taskId,
  );
  return error === null
    ? { ok: true, declaration: parsed.declaration, artifact: artifact! }
    : { ok: false, error };
}

export function verifyProductionReplacementCompletion(args: {
  raw: string;
  taskId: string;
  projectDir: string;
}): ProductionReplacementCompletionResult {
  const resolved = resolveProductionReplacementCompletion(args);
  return resolved.ok
    ? { ok: true, declaration: resolved.declaration }
    : resolved;
}

export function enforceProductionReplacementCompletion(args: {
  raw: string;
  taskId: string;
  projectDir: string;
}): ProductionReplacementCompletionResult {
  const resolved = resolveProductionReplacementCompletion(args);
  if (!resolved.ok) return resolved;
  const error = runProductionReplacementTests({
    projectDir: args.projectDir,
    declaration: resolved.declaration,
    artifact: resolved.artifact,
  });
  return error === null
    ? { ok: true, declaration: resolved.declaration }
    : { ok: false, error };
}
