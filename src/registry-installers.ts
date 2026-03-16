/**
 * Registry installer implementations — per-source-type install mechanics
 * (npm, URL, GitHub). Extracted from registry.ts for testability.
 *
 * Each installer receives a resolved kotaDir path (not cwd) so it has
 * no implicit dependency on process.cwd().
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { InstallResult, ParsedSource } from "./registry.js";

export const PACKAGES_DIR = "packages";
export const PLUGINS_DIR = "plugins";

export async function installNpm(parsed: ParsedSource, kotaDir: string): Promise<InstallResult> {
  const pkgDir = join(kotaDir, PACKAGES_DIR);
  mkdirSync(pkgDir, { recursive: true });

  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(pkgJsonPath, JSON.stringify({ name: "kota-packages", private: true, dependencies: {} }, null, 2));
  }

  try {
    execFileSync("npm", ["install", parsed.identifier], {
      cwd: pkgDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: Buffer }).stderr?.toString() || err.message : String(err);
    throw new Error(`npm install failed for "${parsed.identifier}": ${msg.slice(0, 500)}`);
  }

  return {
    name: parsed.name,
    source: "npm",
    files: [`${PACKAGES_DIR}/node_modules/${parsed.identifier}`],
  };
}

export async function installUrl(parsed: ParsedSource, kotaDir: string): Promise<InstallResult> {
  const pluginsDir = join(kotaDir, PLUGINS_DIR);
  mkdirSync(pluginsDir, { recursive: true });

  let filename: string;
  try {
    filename = basename(new URL(parsed.identifier).pathname);
  } catch {
    throw new Error(`Invalid URL: ${parsed.identifier}`);
  }
  if (!filename.endsWith(".js") && !filename.endsWith(".mjs")) {
    filename = `${parsed.name}.mjs`;
  }

  const destPath = join(pluginsDir, filename);
  if (existsSync(destPath)) {
    throw new Error(`File "${filename}" already exists in plugins directory`);
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
    throw new Error("URL returned HTML instead of JavaScript — check the URL points to a raw .js/.mjs file");
  }

  const content = await response.text();

  // Validate: must contain JS export patterns (not just the word "export" in HTML)
  const hasEsmExport = /\bexport\s+(default|function|const|let|var|class|\{)/.test(content);
  const hasCjsExport = /\bmodule\.exports\b/.test(content);
  if (!hasEsmExport && !hasCjsExport) {
    throw new Error("Downloaded file doesn't appear to be a valid tool module (no exports found)");
  }

  writeFileSync(destPath, content);

  return {
    name: parsed.name,
    source: "url",
    files: [`${PLUGINS_DIR}/${filename}`],
  };
}

export async function installGithub(parsed: ParsedSource, kotaDir: string): Promise<InstallResult> {
  const pkgDir = join(kotaDir, PACKAGES_DIR);
  mkdirSync(pkgDir, { recursive: true });

  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(pkgJsonPath, JSON.stringify({ name: "kota-packages", private: true, dependencies: {} }, null, 2));
  }

  const gitUrl = `github:${parsed.identifier}`;
  try {
    execFileSync("npm", ["install", gitUrl], {
      cwd: pkgDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: Buffer }).stderr?.toString() || err.message : String(err);
    throw new Error(`GitHub install failed for "${parsed.identifier}": ${msg.slice(0, 500)}`);
  }

  // Determine actual package name from npm's package.json dependencies.
  // The repo name may differ from the package name in its package.json,
  // so we check what npm actually recorded.
  const actualPkg = resolveInstalledPackageName(pkgDir, parsed.identifier);

  return {
    name: parsed.name,
    source: "github",
    files: [`${PACKAGES_DIR}/node_modules/${actualPkg}`],
  };
}

/**
 * After `npm install github:owner/repo`, determine the actual installed
 * package name by inspecting npm's recorded dependencies.
 * Falls back to the repo name if detection fails.
 */
export function resolveInstalledPackageName(pkgDir: string, identifier: string): string {
  const fallback = identifier.split("/").pop()!;
  try {
    const pkgJson = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf-8"));
    const deps = pkgJson.dependencies as Record<string, string> | undefined;
    if (!deps) return fallback;
    // Find the dependency whose spec references the github source
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
 * Read the installed version of an npm package from its package.json.
 * Works with both regular and scoped (@scope/name) packages — path.join
 * handles forward slashes in package names correctly.
 */
export function getNpmVersion(pkg: string, kotaDir: string): string {
  const pkgDir = join(kotaDir, PACKAGES_DIR);
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(pkgDir, "node_modules", pkg, "package.json"), "utf-8"),
    );
    return pkgJson.version || "unknown";
  } catch {
    return "unknown";
  }
}
