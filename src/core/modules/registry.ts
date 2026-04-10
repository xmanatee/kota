/**
 * Remote tool registry — install, remove, and manage KOTA modules
 * from external sources (npm packages, URLs, GitHub repos).
 *
 * Installed modules are tracked in `.kota/tools.json` and discovered by
 * discoverModules() via `.kota/modules/<name>/`.
 *
 * Per-source-type install mechanics live in registry-installers.ts.
 * Source parsing (parseSource, ParsedSource, InstallResult) lives in registry-source.ts.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  EXTENSIONS_DIR,
  getNpmVersion,
  installGithub,
  installNpm,
  installUrl,
  resolveInstalledPackageName,
} from "./registry-installers.js";
import {
  type InstallResult,
  type ParsedSource,
  parseSource,
  type SourceType,
} from "./registry-source.js";

export type { InstallResult, ParsedSource, SourceType };
export { parseSource };

// --- Types ---

export type InstalledTool = {
  source: SourceType;
  /** Original source URI (npm package name, URL, or github:owner/repo) */
  uri: string;
  /** Version string (npm version or "latest" for URLs) */
  version: string;
  /** Files/dirs created by this installation (relative to .kota/) */
  files: string[];
  /** ISO timestamp */
  installedAt: string;
};

export type ToolManifest = {
  tools: Record<string, InstalledTool>;
};

// --- Paths ---

const KOTA_DIR = ".kota";
const MANIFEST_FILE = "tools.json";

function kotaDir(cwd?: string): string {
  return resolve(cwd || process.cwd(), KOTA_DIR);
}

// --- Manifest ---

export function loadManifest(cwd?: string): ToolManifest {
  const dir = kotaDir(cwd);
  const primary = join(dir, MANIFEST_FILE);
  const tmp = `${primary}.tmp`;
  // Try primary file, fall back to tmp (crash recovery: if the process
  // died after writing the tmp but before renaming it, the tmp has the
  // latest data while the primary may be absent or stale).
  for (const p of [primary, tmp]) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      if (typeof raw === "object" && raw !== null && typeof raw.tools === "object") {
        return raw as ToolManifest;
      }
    } catch {
      // corrupted — try next candidate
    }
  }
  return { tools: {} };
}

export function saveManifest(manifest: ToolManifest, cwd?: string): void {
  const dir = kotaDir(cwd);
  mkdirSync(dir, { recursive: true });
  const manifestPath = join(dir, MANIFEST_FILE);
  const tmpPath = `${manifestPath}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(manifest, null, 2)}\n`);
  renameSync(tmpPath, manifestPath);
}

// --- Install ---

export async function installTool(
  source: string,
  cwd?: string,
): Promise<InstallResult> {
  const parsed = parseSource(source);
  const manifest = loadManifest(cwd);

  if (manifest.tools[parsed.name]) {
    throw new Error(
      `Tool "${parsed.name}" already installed (from ${manifest.tools[parsed.name].uri}). ` +
        `Remove it first with: kota tools remove ${parsed.name}`,
    );
  }

  const dir = kotaDir(cwd);
  let result: InstallResult;

  switch (parsed.type) {
    case "npm":
      result = await installNpm(parsed, dir);
      break;
    case "url":
      result = await installUrl(parsed, dir);
      break;
    case "github":
      result = await installGithub(parsed, dir);
      break;
  }

  // Resolve installed version for npm/github packages.
  let version = "latest";
  if (parsed.type === "npm" || parsed.type === "github") {
    const actualPkg =
      parsed.type === "npm"
        ? parsed.identifier
        : resolveInstalledPackageName(
            join(dir, EXTENSIONS_DIR, parsed.name),
            parsed.identifier,
          );
    const pkgDir = join(dir, EXTENSIONS_DIR, parsed.name, "node_modules", ...actualPkg.split("/"));
    version = getNpmVersion(pkgDir);
  }

  manifest.tools[result.name] = {
    source: parsed.type,
    uri: parsed.identifier,
    version,
    files: result.files,
    installedAt: new Date().toISOString(),
  };
  saveManifest(manifest, cwd);

  return result;
}

// --- Remove ---

export function removeTool(name: string, cwd?: string): boolean {
  const manifest = loadManifest(cwd);
  const tool = manifest.tools[name];
  if (!tool) return false;

  const dir = kotaDir(cwd);

  // Remove all files/directories tracked for this installation
  for (const file of tool.files) {
    const absPath = join(dir, file);
    if (existsSync(absPath)) {
      rmSync(absPath, { recursive: true, force: true });
    }
  }

  delete manifest.tools[name];
  saveManifest(manifest, cwd);
  return true;
}

// --- List ---

export type ToolInfo = InstalledTool & { name: string };

export function listTools(cwd?: string): ToolInfo[] {
  const manifest = loadManifest(cwd);
  return Object.entries(manifest.tools).map(([name, tool]) => ({
    name,
    ...tool,
  }));
}

// --- Update ---

export async function updateTool(name: string, cwd?: string): Promise<InstallResult> {
  const manifest = loadManifest(cwd);
  const tool = manifest.tools[name];
  if (!tool) throw new Error(`Tool "${name}" is not installed`);

  // Remove from manifest so installTool doesn't reject as duplicate,
  // and move old files to backup so installUrl/installNpm don't hit conflicts.
  const savedTool = { ...tool };
  delete manifest.tools[name];
  saveManifest(manifest, cwd);

  const dir = kotaDir(cwd);
  const backups: Array<{ original: string; backup: string }> = [];

  const sourcePrefix = tool.source === "npm" ? "npm:" : tool.source === "github" ? "github:" : "";
  try {
    // Move old files to backup — inside try so a partial rename failure
    // (e.g. EPERM on the second file) triggers the restore logic below
    // instead of leaving the tool in a half-backed-up state.
    for (const file of savedTool.files) {
      const absPath = join(dir, file);
      if (existsSync(absPath)) {
        const backupPath = `${absPath}.kota-update-bak`;
        renameSync(absPath, backupPath);
        backups.push({ original: absPath, backup: backupPath });
      }
    }

    const result = await installTool(`${sourcePrefix}${tool.uri}`, cwd);

    // Install succeeded — remove backups
    for (const { backup } of backups) {
      if (existsSync(backup)) {
        rmSync(backup, { recursive: true, force: true });
      }
    }

    return result;
  } catch (err) {
    // Restore backups and manifest entry
    for (const { original, backup } of backups) {
      if (existsSync(backup)) {
        renameSync(backup, original);
      }
    }
    const current = loadManifest(cwd);
    current.tools[name] = savedTool;
    saveManifest(current, cwd);
    throw err;
  }
}
