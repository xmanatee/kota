/**
 * Registry installer implementations — per-source-type install mechanics
 * (npm, URL, GitHub). Extracted from registry.ts for testability.
 *
 * All installed modules land under `.kota/modules/<name>/`:
 * - URL downloads:    `.kota/modules/<name>/index.mjs`
 * - npm packages:     `.kota/modules/<name>/` (with its own node_modules)
 * - GitHub packages:  same as npm
 *
 * Each installer receives a resolved kotaDir path (not cwd) so it has
 * no implicit dependency on process.cwd().
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { InstallResult, ParsedSource } from "./registry.js";

export const MODULES_DIR = "modules";

export async function installNpm(parsed: ParsedSource, kotaDir: string): Promise<InstallResult> {
  const moduleDir = join(kotaDir, MODULES_DIR, parsed.name);
  mkdirSync(moduleDir, { recursive: true });

  const pkgJsonPath = join(moduleDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(
      pkgJsonPath,
      JSON.stringify(
        { name: `${parsed.name}-ext`, private: true, dependencies: {} },
        null,
        2,
      ),
    );
  }

  try {
    execFileSync("npm", ["install", parsed.identifier], {
      cwd: moduleDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    const msg =
      err instanceof Error
        ? (err as { stderr?: Buffer }).stderr?.toString() || err.message
        : String(err);
    throw new Error(`npm install failed for "${parsed.identifier}": ${msg.slice(0, 500)}`);
  }

  // Resolve the installed package's entry point and record it in the wrapper
  // package.json so module discovery can find it via the "main" field.
  const installedPkgName = resolveInstalledPackageName(moduleDir, parsed.identifier);
  const installedPkgDir = join(moduleDir, "node_modules", ...installedPkgName.split("/"));
  const entryPath = resolveNpmEntry(installedPkgDir);
  if (entryPath) {
    const relEntry = `node_modules/${installedPkgName}/${entryPath}`;
    const wrapper = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
    wrapper.main = relEntry;
    writeFileSync(pkgJsonPath, `${JSON.stringify(wrapper, null, 2)}\n`);
  }

  return {
    name: parsed.name,
    source: "npm",
    files: [`${MODULES_DIR}/${parsed.name}`],
  };
}

export async function installUrl(parsed: ParsedSource, kotaDir: string): Promise<InstallResult> {
  const moduleDir = join(kotaDir, MODULES_DIR, parsed.name);
  mkdirSync(moduleDir, { recursive: true });

  const destPath = join(moduleDir, "index.mjs");
  if (existsSync(destPath)) {
    throw new Error(`Module "${parsed.name}" already exists in modules directory`);
  }

  let response: Response;
  try {
    response = await fetch(parsed.identifier);
  } catch (err) {
    throw new Error(`Download failed for "${parsed.identifier}": ${(err as Error).message}`);
  }
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error(
      "URL returned HTML instead of JavaScript — check the URL points to a raw .js/.mjs file",
    );
  }

  const content = await response.text();

  // Validate: must contain JS export patterns (not just the word "export" in HTML)
  const hasEsmExport = /\bexport\s+(default|function|const|let|var|class|\{)/.test(content);
  const hasCjsExport = /\bmodule\.exports\b/.test(content);
  if (!hasEsmExport && !hasCjsExport) {
    throw new Error(
      "Downloaded file doesn't appear to be a valid tool module (no exports found)",
    );
  }

  writeFileSync(destPath, content);

  return {
    name: parsed.name,
    source: "url",
    files: [`${MODULES_DIR}/${parsed.name}`],
  };
}

export async function installGithub(parsed: ParsedSource, kotaDir: string): Promise<InstallResult> {
  const moduleDir = join(kotaDir, MODULES_DIR, parsed.name);
  mkdirSync(moduleDir, { recursive: true });

  const pkgJsonPath = join(moduleDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(
      pkgJsonPath,
      JSON.stringify(
        { name: `${parsed.name}-ext`, private: true, dependencies: {} },
        null,
        2,
      ),
    );
  }

  const gitUrl = `github:${parsed.identifier}`;
  try {
    execFileSync("npm", ["install", gitUrl], {
      cwd: moduleDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    const msg =
      err instanceof Error
        ? (err as { stderr?: Buffer }).stderr?.toString() || err.message
        : String(err);
    throw new Error(`GitHub install failed for "${parsed.identifier}": ${msg.slice(0, 500)}`);
  }

  // Determine actual package name and resolve entry point.
  const actualPkg = resolveInstalledPackageName(moduleDir, parsed.identifier);
  const installedPkgDir = join(moduleDir, "node_modules", ...actualPkg.split("/"));
  const entryPath = resolveNpmEntry(installedPkgDir);
  if (entryPath) {
    const relEntry = `node_modules/${actualPkg}/${entryPath}`;
    const wrapper = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as Record<string, unknown>;
    wrapper.main = relEntry;
    writeFileSync(pkgJsonPath, `${JSON.stringify(wrapper, null, 2)}\n`);
  }

  return {
    name: parsed.name,
    source: "github",
    files: [`${MODULES_DIR}/${parsed.name}`],
  };
}

/**
 * After `npm install <pkg>` or `npm install github:owner/repo`, determine the
 * actual installed package name by inspecting npm's recorded dependencies.
 * Falls back to the repo/package name if detection fails.
 */
export function resolveInstalledPackageName(moduleDir: string, identifier: string): string {
  const fallback = identifier.split("/").pop()!;
  try {
    const pkgJson = JSON.parse(readFileSync(join(moduleDir, "package.json"), "utf-8")) as {
      dependencies?: Record<string, string>;
    };
    const deps = pkgJson.dependencies;
    if (!deps) return fallback;
    for (const [name, spec] of Object.entries(deps)) {
      if (spec.includes(identifier) || spec.includes(`github:${identifier}`)) {
        return name;
      }
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Resolve the entry point of an installed npm package from its package.json.
 * Returns the relative entry path (e.g., "dist/index.js") or null if not found.
 */
export function resolveNpmEntry(pkgDir: string): string | null {
  try {
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as {
      main?: string;
      exports?: unknown;
    };
    const main =
      pkgJson.exports != null
        ? (pkgJson.exports as Record<string, unknown>)["."] ?? pkgJson.main
        : pkgJson.main;
    if (!main) return "index.js";
    return typeof main === "string"
      ? main
      : ((main as Record<string, string>)?.default ??
          (main as Record<string, string>)?.import ??
          "index.js");
  } catch {
    return null;
  }
}

/**
 * Read the installed version of an npm package from its package.json.
 * Takes the full path to the package directory (e.g. moduleDir/node_modules/pkg).
 */
export function getNpmVersion(pkgDir: string): string {
  try {
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkgJson.version || "unknown";
  } catch {
    return "unknown";
  }
}
