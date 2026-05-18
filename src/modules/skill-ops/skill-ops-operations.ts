/**
 * Shared logic for `kota skill list` / `kota skill import`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import {
  IMPORTED_SKILL_ACTIVATION,
  IMPORTED_SKILL_PROVENANCE_FILE,
  IMPORTED_SKILL_SOURCE,
  type ImportedSkillProvenance,
  type ImportedSkillSkippedFile,
  importedSkillsDir,
  parseImportedSkillContent,
  readImportedSkillRecords,
} from "#core/modules/imported-skills.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  ImportedSkillWrite,
  SkillImportOptions,
  SkillImportResult,
  SkillSummary,
  SkillsListResult,
} from "./client.js";

type SkillImportFailure = Extract<SkillImportResult, { ok: false }>;

type SkillSourceKind =
  | "single-file"
  | "skill-directory"
  | "directory-pack"
  | "repo-pack";

type CandidateResource =
  | {
      kind: "local";
      relativePath: string;
      sourcePath: string;
    }
  | {
      kind: "remote";
      relativePath: string;
      url: string;
    };

type SkillCandidate = {
  content: string;
  sourcePath: string;
  originalSource: string;
  provenance: string;
  kind: SkillSourceKind;
  resources: CandidateResource[];
  skippedResources: ImportedSkillSkippedFile[];
  selectionName?: string;
  fallbackName?: string;
};

type PreparedSkillWrite = ImportedSkillWrite & {
  serialized: string;
  resources: CandidateResource[];
  provenanceRecord: ImportedSkillProvenance;
};

type GitHubSource =
  | {
      kind: "repo" | "tree";
      owner: string;
      repo: string;
      ref?: string;
      path: string;
      originalSource: string;
    }
  | {
      kind: "blob";
      owner: string;
      repo: string;
      ref: string;
      path: string;
      originalSource: string;
    };

type GitHubRepoResponse = {
  default_branch?: string;
};

type GitHubTreeItem = {
  path?: string;
  type?: string;
};

type GitHubTreeResponse = {
  tree?: GitHubTreeItem[];
};

const IGNORED_PACK_DIRS = new Set([".git", "node_modules"]);

/**
 * Read every skill file under `.kota/skills/` and surface them with the
 * `imported` source. Invalid files throw with the concrete path and field so
 * operators do not mistake inert prompt files for active skills.
 */
export function readImportedSkills(
  cwd: string,
  moduleSkillOwners: ReadonlyMap<string, string> = new Map(),
): SkillSummary[] {
  return readImportedSkillRecords(cwd).map((record) => {
    const shadowedBy = moduleSkillOwners.get(record.def.name);
    return {
      name: record.def.name,
      source: IMPORTED_SKILL_SOURCE,
      sourceType: "imported",
      status: shadowedBy ? "shadowed" : "resolvable",
      activation: IMPORTED_SKILL_ACTIVATION,
      ...(record.def.description !== undefined && { description: record.def.description }),
      promptPath: record.def.promptPath,
      ...(record.def.roles !== undefined && { roles: record.def.roles }),
      ...(record.provenance !== undefined && { provenance: record.provenance }),
      ...(record.resourceSummary !== undefined && { resourceSummary: record.resourceSummary }),
      ...(shadowedBy !== undefined && { shadowedBy }),
    };
  });
}

/**
 * Combine module-contributed skills with imported skills, preferring the
 * module-contributed entry when both share a name (matches the CLI's
 * pre-migration behavior).
 */
export function listSkills(ctx: ModuleContext): SkillsListResult {
  const summaries = ctx.getModuleSummaries();
  const skills: SkillSummary[] = [];
  const moduleSkillOwners = new Map<string, string>();
  for (const summary of summaries) {
    for (const skill of summary.skills) {
      if (!moduleSkillOwners.has(skill.name)) moduleSkillOwners.set(skill.name, summary.name);
      skills.push({
        name: skill.name,
        source: summary.name,
        sourceType: "module",
        status: "resolvable",
        activation: "default",
        ...(skill.description !== undefined && { description: skill.description }),
        promptPath: skill.promptPath,
        ...(skill.roles !== undefined && { roles: skill.roles }),
      });
    }
  }
  skills.push(...readImportedSkills(ctx.cwd, moduleSkillOwners));
  return { skills };
}

function failure(
  reason: SkillImportFailure["reason"],
  message: string,
): SkillImportFailure {
  return { ok: false, reason, message };
}

function readFrontmatterName(content: string): string | undefined {
  const { attrs } = parseFlatFrontMatter(content);
  return typeof attrs.name === "string" && attrs.name.trim()
    ? attrs.name.trim()
    : undefined;
}

function selectorList(candidates: readonly SkillCandidate[]): string {
  return candidates
    .map((candidate) =>
      candidate.selectionName
        ? `${candidate.selectionName} (${candidate.sourcePath})`
        : `(unnamed ${candidate.sourcePath})`
    )
    .join(", ");
}

async function fetchText(source: string): Promise<string> {
  const res = await fetch(source);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

async function fetchJson<T>(source: string): Promise<T> {
  const res = await fetch(source);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function fetchBytes(source: string): Promise<Buffer> {
  const res = await fetch(source);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return Buffer.from(await res.arrayBuffer());
}

async function fetchSkillContent(source: string): Promise<string> {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return fetchText(source);
  }
  if (!existsSync(source)) throw new Error(`File not found: ${source}`);
  return readFileSync(source, "utf8");
}

function isSkillMarkdownPath(path: string): boolean {
  return basename(path).toLowerCase() === "skill.md";
}

function isPosixSkillMarkdownPath(path: string): boolean {
  return posix.basename(path).toLowerCase() === "skill.md";
}

function inferSkillDirectoryName(path: string): string | undefined {
  const name = basename(dirname(path)).trim();
  return name && name !== "." ? name : undefined;
}

function inferPosixSkillDirectoryName(path: string): string | undefined {
  const name = posix.basename(posix.dirname(path)).trim();
  return name && name !== "." ? name : undefined;
}

function makeCandidate(args: {
  content: string;
  sourcePath: string;
  originalSource: string;
  provenance: string;
  kind: SkillSourceKind;
  resources?: CandidateResource[];
  skippedResources?: ImportedSkillSkippedFile[];
  fallbackName?: string;
}): SkillCandidate {
  const frontmatterName = readFrontmatterName(args.content);
  return {
    content: args.content,
    sourcePath: args.sourcePath,
    originalSource: args.originalSource,
    provenance: args.provenance,
    kind: args.kind,
    resources: args.resources ?? [],
    skippedResources: args.skippedResources ?? [],
    selectionName: frontmatterName ?? args.fallbackName,
    ...(args.fallbackName !== undefined && { fallbackName: args.fallbackName }),
  };
}

function toPosixPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function skipped(path: string, reason: string): ImportedSkillSkippedFile {
  return { path: toPosixPath(path), reason };
}

function shouldSkipResourcePath(relativePath: string): string | null {
  const parts = relativePath.split("/");
  const ignored = parts.find((part) => IGNORED_PACK_DIRS.has(part));
  if (ignored) return `${ignored} directory is not imported`;
  if (parts.at(-1) === IMPORTED_SKILL_PROVENANCE_FILE) {
    return `${IMPORTED_SKILL_PROVENANCE_FILE} is reserved for KOTA import provenance`;
  }
  return null;
}

function collectLocalSkillResources(skillDir: string, skillPath: string): {
  resources: CandidateResource[];
  skippedResources: ImportedSkillSkippedFile[];
} {
  const resolvedSkillPath = resolve(skillPath);
  const resources: CandidateResource[] = [];
  const skippedResources: ImportedSkillSkippedFile[] = [];
  const visit = (dir: string, prefix = "") => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = toPosixPath(prefix ? `${prefix}/${entry.name}` : entry.name);
      const stat = lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        skippedResources.push(skipped(
          relativePath,
          "symlink skipped to keep imported resources inside the skill directory",
        ));
        continue;
      }
      if (entry.isDirectory()) {
        const reason = shouldSkipResourcePath(relativePath);
        if (reason) {
          skippedResources.push(skipped(relativePath, reason));
          continue;
        }
        visit(fullPath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (resolve(fullPath) === resolvedSkillPath) continue;
      const reason = shouldSkipResourcePath(relativePath);
      if (reason) {
        skippedResources.push(skipped(relativePath, reason));
        continue;
      }
      resources.push({ kind: "local", relativePath, sourcePath: fullPath });
    }
  };
  visit(skillDir);
  return { resources, skippedResources };
}

function findLocalSkillFiles(root: string): string[] {
  const resolvedRoot = resolve(root);
  const found: string[] = [];
  const visit = (dir: string) => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_PACK_DIRS.has(entry.name)) visit(path);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase() === "skill.md") {
        found.push(path);
      }
    }
  };
  visit(resolvedRoot);
  return found;
}

function localPackProvenance(args: {
  source: string;
  sourceRoot: string;
  skillPath: string;
  kind: SkillSourceKind;
  skillName: string;
}): string {
  if (args.kind === "single-file") return args.source;
  const relativeSkillPath = relative(resolve(args.sourceRoot), args.skillPath) || basename(args.skillPath);
  return `${args.kind}: ${args.source} -> ${relativeSkillPath} (skill: ${args.skillName})`;
}

function readLocalSource(source: string): SkillCandidate[] | SkillImportFailure {
  if (!existsSync(source)) return failure("fetch_failed", `File not found: ${source}`);
  const stat = statSync(source);
  if (stat.isDirectory()) {
    const skillFiles = findLocalSkillFiles(source);
    if (skillFiles.length === 0) {
      return failure("invalid_pack", `Skill pack "${source}" contains no SKILL.md files.`);
    }
    const resolvedSource = resolve(source);
    return skillFiles.map((skillPath) => {
      const directSkillDirectory = resolve(dirname(skillPath)) === resolvedSource;
      const kind: SkillSourceKind =
        skillFiles.length === 1 && directSkillDirectory
          ? "skill-directory"
          : "directory-pack";
      const fallbackName = inferSkillDirectoryName(skillPath);
      const content = readFileSync(skillPath, "utf8");
      const selectionName = readFrontmatterName(content) ?? fallbackName ?? basename(resolvedSource);
      const { resources, skippedResources } = collectLocalSkillResources(
        dirname(skillPath),
        skillPath,
      );
      return makeCandidate({
        content,
        sourcePath: skillPath,
        originalSource: source,
        kind,
        resources,
        skippedResources,
        fallbackName,
        provenance: localPackProvenance({
          source,
          sourceRoot: source,
          skillPath,
          kind,
          skillName: selectionName,
        }),
      });
    });
  }
  if (!stat.isFile()) {
    return failure("fetch_failed", `Unsupported source path: ${source}`);
  }
  const content = readFileSync(source, "utf8");
  const fallbackName = isSkillMarkdownPath(source) ? inferSkillDirectoryName(source) : undefined;
  const kind: SkillSourceKind = fallbackName ? "skill-directory" : "single-file";
  const selectionName = readFrontmatterName(content) ?? fallbackName ?? basename(source);
  const resourceData = fallbackName
    ? collectLocalSkillResources(dirname(source), source)
    : { resources: [], skippedResources: [] };
  return [
    makeCandidate({
      content,
      sourcePath: source,
      originalSource: source,
      kind,
      ...resourceData,
      ...(fallbackName !== undefined && { fallbackName }),
      provenance: localPackProvenance({
        source,
        sourceRoot: dirname(source),
        skillPath: source,
        kind,
        skillName: selectionName,
      }),
    }),
  ];
}

function parseGitHubSource(source: string): GitHubSource | null {
  const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(source);
  if (shorthand) {
    return {
      kind: "repo",
      owner: shorthand[1],
      repo: shorthand[2].replace(/\.git$/, ""),
      path: "",
      originalSource: source,
    };
  }

  if (!source.startsWith("http://") && !source.startsWith("https://")) return null;
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");
  if (parts.length === 2) {
    return { kind: "repo", owner, repo, path: "", originalSource: source };
  }
  const marker = parts[2];
  if ((marker === "tree" || marker === "blob") && parts.length >= 4) {
    const ref = parts[3];
    const path = parts.slice(4).join("/");
    if (marker === "blob") {
      return { kind: "blob", owner, repo, ref, path, originalSource: source };
    }
    return { kind: "tree", owner, repo, ref, path, originalSource: source };
  }
  return null;
}

function rawGitHubUrl(source: GitHubSource & { kind: "blob" }, path = source.path): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${encodeURIComponent(source.ref)}/${encodedPath}`;
}

function rawGitHubTreeUrl(source: Exclude<GitHubSource, { kind: "blob" }>, ref: string, path: string): string {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${encodeURIComponent(ref)}/${encodedPath}`;
}

function relativePathInPosixDir(directory: string, path: string): string | null {
  if (directory === "." || directory === "") return path;
  if (!path.startsWith(`${directory}/`)) return null;
  return path.slice(directory.length + 1);
}

function collectGitHubSkillResources(args: {
  source: Exclude<GitHubSource, { kind: "blob" }>;
  ref: string;
  skillPath: string;
  tree: GitHubTreeItem[];
}): {
  resources: CandidateResource[];
  skippedResources: ImportedSkillSkippedFile[];
} {
  const resources: CandidateResource[] = [];
  const skippedResources: ImportedSkillSkippedFile[] = [];
  const skillDir = posix.dirname(args.skillPath);
  for (const item of args.tree) {
    if (item.type !== "blob" || !item.path || item.path === args.skillPath) continue;
    const relativePath = relativePathInPosixDir(skillDir, item.path);
    if (!relativePath) continue;
    const reason = shouldSkipResourcePath(relativePath);
    if (reason) {
      skippedResources.push(skipped(relativePath, reason));
      continue;
    }
    resources.push({
      kind: "remote",
      relativePath,
      url: rawGitHubTreeUrl(args.source, args.ref, item.path),
    });
  }
  return { resources, skippedResources };
}

async function resolveGitHubRef(source: Exclude<GitHubSource, { kind: "blob" }>): Promise<string> {
  if (source.ref) return source.ref;
  const repo = await fetchJson<GitHubRepoResponse>(
    `https://api.github.com/repos/${source.owner}/${source.repo}`,
  );
  if (!repo.default_branch) {
    throw new Error(`GitHub repository ${source.owner}/${source.repo} has no default_branch`);
  }
  return repo.default_branch;
}

async function readGitHubSource(
  source: GitHubSource,
  options?: SkillImportOptions,
): Promise<SkillCandidate[] | SkillImportFailure> {
  if (source.kind === "blob") {
    const content = await fetchText(rawGitHubUrl(source));
    const fallbackName = isPosixSkillMarkdownPath(source.path)
      ? inferPosixSkillDirectoryName(source.path)
      : undefined;
    return [
      makeCandidate({
        content,
        sourcePath: source.path,
        originalSource: source.originalSource,
        kind: fallbackName ? "skill-directory" : "single-file",
        ...(fallbackName !== undefined && { fallbackName }),
        provenance: source.originalSource,
      }),
    ];
  }

  const ref = await resolveGitHubRef(source);
  const tree = await fetchJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
  );
  const prefix = source.path.replace(/^\/+|\/+$/g, "");
  const skillPaths = (tree.tree ?? [])
    .filter((item) => item.type === "blob" && item.path && posix.basename(item.path).toLowerCase() === "skill.md")
    .map((item) => item.path as string)
    .filter((path) => !prefix || path === `${prefix}/SKILL.md` || path.startsWith(`${prefix}/`))
    .sort((a, b) => a.localeCompare(b));
  if (skillPaths.length === 0) {
    return failure(
      "invalid_pack",
      `GitHub skill pack "${source.originalSource}" contains no SKILL.md files.`,
    );
  }
  const fallbackMatches = options?.skill
    ? skillPaths.filter((path) => posix.basename(posix.dirname(path)) === options.skill)
    : [];
  const pathsToFetch = fallbackMatches.length > 0 ? fallbackMatches : skillPaths;
  const candidates: SkillCandidate[] = [];
  for (const skillPath of pathsToFetch) {
    const content = await fetchText(rawGitHubTreeUrl(source, ref, skillPath));
    const fallbackName = posix.basename(posix.dirname(skillPath));
    const selectionName = readFrontmatterName(content) ?? fallbackName;
    const { resources, skippedResources } = collectGitHubSkillResources({
      source,
      ref,
      skillPath,
      tree: tree.tree ?? [],
    });
    candidates.push(makeCandidate({
      content,
      sourcePath: skillPath,
      originalSource: source.originalSource,
      kind: "repo-pack",
      resources,
      skippedResources,
      fallbackName,
      provenance: `repo-pack: ${source.originalSource} -> ${skillPath} (skill: ${selectionName})`,
    }));
  }
  return candidates;
}

async function resolveSourceCandidates(
  source: string,
  options?: SkillImportOptions,
): Promise<SkillCandidate[] | SkillImportFailure> {
  if (existsSync(source)) return readLocalSource(source);
  const githubSource = parseGitHubSource(source);
  if (githubSource) {
    try {
      return await readGitHubSource(githubSource, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failure("fetch_failed", message);
    }
  }
  try {
    const content = await fetchSkillContent(source);
    return [
      makeCandidate({
        content,
        sourcePath: source,
        originalSource: source,
        kind: "single-file",
        provenance: source,
      }),
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure("fetch_failed", message);
  }
}

function selectCandidates(
  source: string,
  candidates: readonly SkillCandidate[],
  options?: SkillImportOptions,
): SkillCandidate[] | SkillImportFailure {
  if (candidates.length === 0) {
    return failure("invalid_pack", `Skill source "${source}" contains no importable skills.`);
  }
  if (options?.all && options.skill) {
    return failure("invalid_skill", "Pass either --skill <name> or --all, not both.");
  }
  if (options?.skill) {
    const matches = candidates.filter((candidate) => candidate.selectionName === options.skill);
    if (matches.length === 0) {
      return failure(
        "skill_not_found",
        `Skill "${options.skill}" was not found in "${source}". Available skills: ${selectorList(candidates)}.`,
      );
    }
    if (matches.length > 1) {
      return failure(
        "ambiguous_pack",
        `Skill "${options.skill}" matches multiple SKILL.md files in "${source}": ${selectorList(matches)}.`,
      );
    }
    return matches;
  }
  if (options?.all) return [...candidates];
  if (candidates.length > 1) {
    return failure(
      "ambiguous_pack",
      `Skill pack "${source}" contains multiple skills: ${selectorList(candidates)}. Pass --skill <name> or --all.`,
    );
  }
  return [...candidates];
}

function formatResourceSummary(importedFiles: readonly string[], skippedFiles: readonly ImportedSkillSkippedFile[]): string {
  const resourceCount = importedFiles.filter((file) => file !== "SKILL.md").length;
  return `${resourceCount} resource${resourceCount === 1 ? "" : "s"}; ${skippedFiles.length} skipped`;
}

function safeDestinationPath(destDir: string, relativePath: string): string {
  const resolvedRoot = resolve(destDir);
  const resolvedDest = resolve(destDir, relativePath);
  const backToRoot = relative(resolvedRoot, resolvedDest);
  if (backToRoot.startsWith("..") || isAbsolute(backToRoot)) {
    throw new Error(`Imported resource path escapes skill directory: ${relativePath}`);
  }
  return resolvedDest;
}

function prepareWrites(
  selected: readonly SkillCandidate[],
  options?: SkillImportOptions,
): PreparedSkillWrite[] | SkillImportFailure {
  if (options?.name && selected.length > 1) {
    return failure("invalid_skill", "--name can only be used when importing one selected skill.");
  }

  const writes: PreparedSkillWrite[] = [];
  const seen = new Map<string, string>();
  for (const candidate of selected) {
    const { attrs, body } = parseFlatFrontMatter(candidate.content);
    const frontmatterName = typeof attrs.name === "string" && attrs.name.trim()
      ? attrs.name.trim()
      : undefined;
    const skillName = options?.name ?? frontmatterName ?? candidate.fallbackName;
    if (!skillName) {
      return failure(
        "missing_name",
        "Skill file has no 'name' field in frontmatter. Pass an explicit name to import it.",
      );
    }
    const previous = seen.get(skillName);
    if (previous) {
      return failure(
        "invalid_pack",
        `Skill pack resolves duplicate skill name "${skillName}" from ${previous} and ${candidate.sourcePath}.`,
      );
    }
    const serialized = serializeFlatFrontMatter(
      { ...attrs, name: skillName, imported_from: candidate.provenance },
      body,
    );
    try {
      parseImportedSkillContent(serialized, join(skillName, "SKILL.md"));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return failure("invalid_skill", message);
    }
    const importedFiles = [
      "SKILL.md",
      ...candidate.resources.map((resource) => resource.relativePath).sort((a, b) =>
        a.localeCompare(b)
      ),
    ];
    const provenanceRecord: ImportedSkillProvenance = {
      version: 1,
      skillName,
      source: candidate.originalSource,
      sourceKind: candidate.kind,
      selectedSkillPath: candidate.sourcePath,
      provenance: candidate.provenance,
      importedFiles,
      skippedFiles: [...candidate.skippedResources].sort((a, b) =>
        a.path.localeCompare(b.path)
      ),
    };
    seen.set(skillName, candidate.sourcePath);
    writes.push({
      name: skillName,
      path: "",
      sourcePath: candidate.sourcePath,
      provenance: candidate.provenance,
      resourceSummary: formatResourceSummary(importedFiles, provenanceRecord.skippedFiles),
      serialized,
      resources: candidate.resources,
      provenanceRecord,
    });
  }
  return writes;
}

/**
 * Fetch a skill from a URL or local path and write it under
 * `.kota/skills/`. Single files preserve the existing frontmatter-first
 * behavior. Pack sources select by SKILL.md name, explicit `--skill`, or
 * explicit `--all`; ambiguous packs fail before writing anything.
 */
export async function importSkill(
  ctx: ModuleContext,
  source: string,
  options?: SkillImportOptions,
): Promise<SkillImportResult> {
  const candidates = await resolveSourceCandidates(source, options);
  if (!Array.isArray(candidates)) return candidates;
  const selected = selectCandidates(source, candidates, options);
  if (!Array.isArray(selected)) return selected;
  const writes = prepareWrites(selected, options);
  if (!Array.isArray(writes)) return writes;

  const dir = importedSkillsDir(ctx.cwd);
  mkdirSync(dir, { recursive: true });
  const installed: ImportedSkillWrite[] = [];
  try {
    for (const write of writes) {
      const destDir = join(dir, write.name);
      const legacyFlatFile = join(dir, `${write.name}.md`);
      rmSync(destDir, { recursive: true, force: true });
      rmSync(legacyFlatFile, { force: true });
      mkdirSync(destDir, { recursive: true });

      const skillPath = join(destDir, "SKILL.md");
      writeFileSync(skillPath, write.serialized, "utf8");
      for (const resource of write.resources) {
        const dest = safeDestinationPath(destDir, resource.relativePath);
        mkdirSync(dirname(dest), { recursive: true });
        if (resource.kind === "local") {
          copyFileSync(resource.sourcePath, dest);
        } else {
          writeFileSync(dest, await fetchBytes(resource.url));
        }
      }
      writeFileSync(
        join(destDir, IMPORTED_SKILL_PROVENANCE_FILE),
        `${JSON.stringify(write.provenanceRecord, null, 2)}\n`,
        "utf8",
      );
      const {
        serialized: _serialized,
        resources: _resources,
        provenanceRecord: _provenanceRecord,
        ...result
      } = write;
      installed.push({ ...result, path: skillPath });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure("fetch_failed", message);
  }
  return { ok: true, skills: installed };
}
