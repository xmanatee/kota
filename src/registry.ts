/**
 * Remote tool registry — install, remove, and manage KOTA tools
 * from external sources (npm packages, URLs, GitHub repos).
 *
 * Installed tools are tracked in `.kota/tools.json` and loaded by PluginManager.
 * - npm packages go to `.kota/packages/node_modules/`
 * - URL downloads go to `.kota/plugins/`
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// --- Types ---

export type SourceType = "npm" | "url" | "github";

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
const PLUGINS_DIR = "plugins";
const PACKAGES_DIR = "packages";

function kotaDir(cwd?: string): string {
  return resolve(cwd || process.cwd(), KOTA_DIR);
}

// --- Manifest ---

export function loadManifest(cwd?: string): ToolManifest {
  const path = join(kotaDir(cwd), MANIFEST_FILE);
  if (!existsSync(path)) return { tools: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof raw === "object" && raw !== null && typeof raw.tools === "object") {
      return raw as ToolManifest;
    }
    return { tools: {} };
  } catch {
    return { tools: {} };
  }
}

export function saveManifest(manifest: ToolManifest, cwd?: string): void {
  const dir = kotaDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

// --- Source parsing ---

export type ParsedSource = {
  type: SourceType;
  /** npm package name, raw URL, or github owner/repo */
  identifier: string;
  /** Display name for the tool (derived from source) */
  name: string;
};

export function parseSource(source: string): ParsedSource {
  // Explicit prefix: npm:package-name
  if (source.startsWith("npm:")) {
    const pkg = source.slice(4);
    return { type: "npm", identifier: pkg, name: npmToName(pkg) };
  }

  // Explicit prefix: github:owner/repo
  if (source.startsWith("github:")) {
    const repo = source.slice(7);
    return { type: "github", identifier: repo, name: githubToName(repo) };
  }

  // URL detection
  if (source.startsWith("https://") || source.startsWith("http://")) {
    return { type: "url", identifier: source, name: urlToName(source) };
  }

  // GitHub shorthand: owner/repo (contains exactly one slash, no dots)
  if (/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(source)) {
    return { type: "github", identifier: source, name: githubToName(source) };
  }

  // Default to npm package
  return { type: "npm", identifier: source, name: npmToName(source) };
}

function npmToName(pkg: string): string {
  // @scope/name -> name, package-name -> package-name
  const base = pkg.includes("/") ? pkg.split("/").pop()! : pkg;
  return base.replace(/^kota-/, "").replace(/^tool-/, "");
}

function urlToName(url: string): string {
  const filename = basename(new URL(url).pathname);
  return filename.replace(/\.(js|mjs|ts)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
}

function githubToName(repo: string): string {
  const parts = repo.split("/");
  return (parts[1] || parts[0]).replace(/^kota-/, "").replace(/^tool-/, "");
}

// --- Install ---

export type InstallResult = {
  name: string;
  source: SourceType;
  files: string[];
};

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

  let result: InstallResult;

  switch (parsed.type) {
    case "npm":
      result = await installNpm(parsed, cwd);
      break;
    case "url":
      result = await installUrl(parsed, cwd);
      break;
    case "github":
      result = await installGithub(parsed, cwd);
      break;
  }

  manifest.tools[result.name] = {
    source: parsed.type,
    uri: parsed.identifier,
    version: parsed.type === "npm" ? getNpmVersion(parsed.identifier, cwd) : "latest",
    files: result.files,
    installedAt: new Date().toISOString(),
  };
  saveManifest(manifest, cwd);

  return result;
}

async function installNpm(parsed: ParsedSource, cwd?: string): Promise<InstallResult> {
  const dir = kotaDir(cwd);
  const pkgDir = join(dir, PACKAGES_DIR);
  mkdirSync(pkgDir, { recursive: true });

  // Initialize package.json if needed
  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(pkgJsonPath, JSON.stringify({ name: "kota-packages", private: true, dependencies: {} }, null, 2));
  }

  // Install via npm
  try {
    execSync(`npm install ${parsed.identifier}`, {
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

async function installUrl(parsed: ParsedSource, cwd?: string): Promise<InstallResult> {
  const dir = kotaDir(cwd);
  const pluginsDir = join(dir, PLUGINS_DIR);
  mkdirSync(pluginsDir, { recursive: true });

  // Determine filename
  let filename = basename(new URL(parsed.identifier).pathname);
  if (!filename.endsWith(".js") && !filename.endsWith(".mjs")) {
    filename = `${parsed.name}.mjs`;
  }

  const destPath = join(pluginsDir, filename);
  if (existsSync(destPath)) {
    throw new Error(`File "${filename}" already exists in plugins directory`);
  }

  // Download
  const response = await fetch(parsed.identifier);
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }
  const content = await response.text();

  // Basic validation: must contain export or module.exports
  if (!content.includes("export") && !content.includes("module.exports")) {
    throw new Error("Downloaded file doesn't appear to be a valid tool module (no exports found)");
  }

  writeFileSync(destPath, content);

  return {
    name: parsed.name,
    source: "url",
    files: [`${PLUGINS_DIR}/${filename}`],
  };
}

async function installGithub(parsed: ParsedSource, cwd?: string): Promise<InstallResult> {
  // Try to install as npm package first (many GitHub repos publish to npm)
  // If the repo has a package.json with a "main" field, we can npm install from GitHub
  const dir = kotaDir(cwd);
  const pkgDir = join(dir, PACKAGES_DIR);
  mkdirSync(pkgDir, { recursive: true });

  const pkgJsonPath = join(pkgDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    writeFileSync(pkgJsonPath, JSON.stringify({ name: "kota-packages", private: true, dependencies: {} }, null, 2));
  }

  const gitUrl = `github:${parsed.identifier}`;
  try {
    execSync(`npm install ${gitUrl}`, {
      cwd: pkgDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  } catch (err) {
    const msg = err instanceof Error ? (err as { stderr?: Buffer }).stderr?.toString() || err.message : String(err);
    throw new Error(`GitHub install failed for "${parsed.identifier}": ${msg.slice(0, 500)}`);
  }

  return {
    name: parsed.name,
    source: "github",
    files: [`${PACKAGES_DIR}/node_modules/${parsed.identifier.split("/").pop()}`],
  };
}

function getNpmVersion(pkg: string, cwd?: string): string {
  const pkgDir = join(kotaDir(cwd), PACKAGES_DIR);
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(pkgDir, "node_modules", pkg, "package.json"), "utf-8"),
    );
    return pkgJson.version || "unknown";
  } catch {
    // For scoped packages, try nested path
    try {
      const pkgJson = JSON.parse(
        readFileSync(join(pkgDir, "node_modules", ...pkg.split("/"), "package.json"), "utf-8"),
      );
      return pkgJson.version || "unknown";
    } catch {
      return "unknown";
    }
  }
}

// --- Remove ---

export function removeTool(name: string, cwd?: string): boolean {
  const manifest = loadManifest(cwd);
  const tool = manifest.tools[name];
  if (!tool) return false;

  const dir = kotaDir(cwd);

  // Remove files
  for (const file of tool.files) {
    const absPath = join(dir, file);
    if (existsSync(absPath)) {
      rmSync(absPath, { recursive: true, force: true });
    }
  }

  // For npm packages, also remove from package.json dependencies
  if (tool.source === "npm") {
    const pkgDir = join(dir, PACKAGES_DIR);
    try {
      execSync(`npm uninstall ${tool.uri}`, {
        cwd: pkgDir,
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // Best effort — files already removed above
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

  // Remove and reinstall
  removeTool(name, cwd);

  const sourcePrefix = tool.source === "npm" ? "npm:" : tool.source === "github" ? "github:" : "";
  return installTool(`${sourcePrefix}${tool.uri}`, cwd);
}

// --- Package loading support ---

/**
 * Returns the list of npm package names installed in .kota/packages/.
 * Used by PluginManager to load npm-installed tools.
 */
export function getInstalledNpmPackages(cwd?: string): string[] {
  const manifest = loadManifest(cwd);
  return Object.values(manifest.tools)
    .filter((t) => t.source === "npm" || t.source === "github")
    .map((t) => t.uri);
}

/**
 * Returns the absolute path to .kota/packages/node_modules/ if it exists.
 */
export function getPackagesNodeModulesDir(cwd?: string): string | null {
  const dir = join(kotaDir(cwd), PACKAGES_DIR, "node_modules");
  return existsSync(dir) ? dir : null;
}
