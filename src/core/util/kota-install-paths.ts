import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export function resolveKotaBinary(): string {
  return join(kotaPackageRoot, "bin", "kota.mjs");
}
