import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { isProtectedScopePath, protectedScopePathError } from "#core/tools/protected-scope-paths.js";
import { readAnchoredTextFile } from "./filesystem/anchored-files.js";

const codeTreeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const kotaPackageRoot = resolve(codeTreeRoot, "..");

/**
 * Source mode reads checked-in assets from the package root. Compiled code
 * reads the same source-relative paths from the build-owned asset tree.
 */
export const kotaRuntimeAssetRoot =
  basename(codeTreeRoot) === "dist"
    ? join(codeTreeRoot, "assets")
    : kotaPackageRoot;

export function resolveKotaRuntimeAsset(sourceRelativePath: string): string {
  return resolve(kotaRuntimeAssetRoot, sourceRelativePath);
}

/** Host-owned authority; never populate external roots from prompt declarations. */
export type PromptReadPolicy = {
  readonly trustedExternalRoots?: readonly string[];
  readonly authorityConfigPath?: string;
  readonly scopeRoot?: string;
};

function isWithin(root: string, path: string): boolean {
  const child = relative(resolve(root), path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/**
 * Read, rather than export a checked pathname: every consumer shares protection
 * checks and descriptor-anchored no-follow I/O. Missing overrides may fall back;
 * unsafe overrides never do. Packaged assets have independent installation authority.
 */
export function readKotaPrompt(
  scopeRoot: string,
  promptPath: string,
  policy: PromptReadPolicy = {},
): string {
  const projectPath = resolve(scopeRoot, promptPath);
  const read = (root: string, path: string): string | undefined => {
    if (isProtectedScopePath(path, {
      cwd: root,
      scopeRoot: policy.scopeRoot ?? scopeRoot,
      authorityConfigPath: policy.authorityConfigPath,
    })) throw new Error(protectedScopePathError(path));
    return readAnchoredTextFile({ rootPath: root, boundaryDir: root, filePath: path })?.content;
  };

  if (isWithin(scopeRoot, projectPath)) {
    const content = read(scopeRoot, projectPath);
    if (content !== undefined) return content;
  } else {
    // An absolute declaration is not itself authorization. External module
    // assets require a host-supplied root, independent of the selected path.
    const root = [kotaRuntimeAssetRoot, ...(policy.trustedExternalRoots ?? [])]
      .find(candidate => isWithin(candidate, projectPath));
    if (root === undefined) throw new Error(`Prompt path is outside authorized roots: ${promptPath}`);
    const content = read(root, projectPath);
    if (content !== undefined) return content;
  }
  if (promptPath.startsWith("src/")) {
    const installPath = resolveKotaRuntimeAsset(promptPath);
    if (!isWithin(kotaRuntimeAssetRoot, installPath)) {
      throw new Error(`Prompt path is outside packaged assets: ${promptPath}`);
    }
    const content = read(kotaRuntimeAssetRoot, installPath);
    if (content !== undefined) return content;
  }
  throw new Error(`Prompt file not found: ${promptPath}`);
}

export function resolveKotaBinary(): string {
  return join(kotaPackageRoot, "bin", "kota.mjs");
}
