import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { splitFrontMatter } from "#core/util/frontmatter.js";

export type RepoAiCheckSource = "agents" | "continue";

export type RepoAiCheckProvenance = {
  source: RepoAiCheckSource;
  root: ".agents/checks" | ".continue/checks";
  relativePath: string;
};

export type RepoAiCheckDefinition = {
  id: string;
  name: string;
  description: string;
  body: string;
  provenance: RepoAiCheckProvenance;
};

export type RepoAiCheckDiagnostic =
  | {
      type: "duplicate-name";
      name: string;
      winnerPath: string;
      ignoredPath: string;
      reason: string;
    }
  | {
      type: "ignored-nested-file";
      path: string;
      reason: string;
    };

export type RepoAiCheckDiscovery = {
  checks: RepoAiCheckDefinition[];
  diagnostics: RepoAiCheckDiagnostic[];
};

export class RepoAiCheckDiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoAiCheckDiscoveryError";
  }
}

type CheckRoot = {
  source: RepoAiCheckSource;
  root: ".agents/checks" | ".continue/checks";
  precedence: number;
};

type ParsedCheckCandidate = {
  name: string;
  description: string;
  body: string;
  provenance: RepoAiCheckProvenance;
  precedence: number;
  sortPath: string;
};

const CHECK_ROOTS: readonly CheckRoot[] = [
  { source: "agents", root: ".agents/checks", precedence: 0 },
  { source: "continue", root: ".continue/checks", precedence: 1 },
];

function normalizeRelativePath(projectDir: string, filePath: string): string {
  return relative(projectDir, filePath).split(sep).join("/");
}

function isMarkdownFile(name: string): boolean {
  return name.endsWith(".md");
}

function stripMatchingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }
  return value;
}

function fail(filePath: string, message: string): never {
  throw new RepoAiCheckDiscoveryError(`${filePath}: ${message}`);
}

function parseCheckFile(projectDir: string, root: CheckRoot, filePath: string): ParsedCheckCandidate {
  const content = readFileSync(filePath, "utf8");
  const split = splitFrontMatter(content);
  const relativePath = normalizeRelativePath(projectDir, filePath);
  if (!split) {
    fail(relativePath, "check file must start with valid frontmatter");
  }

  let name = "";
  let description = "";
  const lines = split.frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 1) {
      fail(relativePath, `malformed frontmatter line ${i + 1}`);
    }
    const key = trimmed.slice(0, colonIdx).trim();
    const value = stripMatchingQuotes(trimmed.slice(colonIdx + 1).trim());
    if (key === "name") name = value.trim();
    if (key === "description") description = value.trim();
  }

  if (!name) fail(relativePath, 'frontmatter "name" must be a non-empty string');
  if (!description) {
    fail(relativePath, 'frontmatter "description" must be a non-empty string');
  }
  const body = split.body.trim();
  if (!body) fail(relativePath, "check body must be non-empty");

  return {
    name,
    description,
    body,
    provenance: {
      source: root.source,
      root: root.root,
      relativePath,
    },
    precedence: root.precedence,
    sortPath: relativePath,
  };
}

function listNestedMarkdownFiles(dir: string, projectDir: string): string[] {
  const nested: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      nested.push(...listNestedMarkdownFiles(fullPath, projectDir));
    } else if (entry.isFile() && isMarkdownFile(entry.name)) {
      nested.push(normalizeRelativePath(projectDir, fullPath));
    }
  }
  return nested.sort((a, b) => a.localeCompare(b));
}

function discoverRoot(projectDir: string, root: CheckRoot): {
  candidates: ParsedCheckCandidate[];
  diagnostics: RepoAiCheckDiagnostic[];
} {
  const rootPath = join(projectDir, root.root);
  if (!existsSync(rootPath)) return { candidates: [], diagnostics: [] };
  if (!statSync(rootPath).isDirectory()) {
    throw new RepoAiCheckDiscoveryError(`${root.root}: check root exists but is not a directory`);
  }

  const candidates: ParsedCheckCandidate[] = [];
  const diagnostics: RepoAiCheckDiagnostic[] = [];
  const entries = readdirSync(rootPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const filePath = join(rootPath, entry.name);
    if (entry.isFile() && isMarkdownFile(entry.name)) {
      candidates.push(parseCheckFile(projectDir, root, filePath));
      continue;
    }
    if (entry.isDirectory()) {
      for (const path of listNestedMarkdownFiles(filePath, projectDir)) {
        diagnostics.push({
          type: "ignored-nested-file",
          path,
          reason: "repo AI checks only load root-level markdown files",
        });
      }
    }
  }
  return { candidates, diagnostics };
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "check";
}

function withStableIds(candidates: ParsedCheckCandidate[]): RepoAiCheckDefinition[] {
  const idCounts = new Map<string, number>();
  return candidates.map((candidate) => {
    const base = slugify(candidate.name);
    const prior = idCounts.get(base) ?? 0;
    idCounts.set(base, prior + 1);
    const id = prior === 0 ? base : `${base}-${prior + 1}`;
    return {
      id,
      name: candidate.name,
      description: candidate.description,
      body: candidate.body,
      provenance: candidate.provenance,
    };
  });
}

function chooseDuplicateWinners(candidates: ParsedCheckCandidate[]): {
  winners: ParsedCheckCandidate[];
  diagnostics: RepoAiCheckDiagnostic[];
} {
  const byName = new Map<string, ParsedCheckCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byName.get(candidate.name) ?? [];
    bucket.push(candidate);
    byName.set(candidate.name, bucket);
  }

  const winners: ParsedCheckCandidate[] = [];
  const diagnostics: RepoAiCheckDiagnostic[] = [];
  for (const [name, group] of [...byName.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = group.sort((a, b) => {
      const precedence = a.precedence - b.precedence;
      if (precedence !== 0) return precedence;
      return a.sortPath.localeCompare(b.sortPath);
    });
    const winner = sorted[0];
    winners.push(winner);
    for (const ignored of sorted.slice(1)) {
      diagnostics.push({
        type: "duplicate-name",
        name,
        winnerPath: winner.provenance.relativePath,
        ignoredPath: ignored.provenance.relativePath,
        reason: ".agents/checks takes precedence over .continue/checks; ties use path order",
      });
    }
  }

  return {
    winners: winners.sort((a, b) => {
      const byNameResult = a.name.localeCompare(b.name);
      if (byNameResult !== 0) return byNameResult;
      return a.sortPath.localeCompare(b.sortPath);
    }),
    diagnostics: diagnostics.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      const aPath = a.type === "duplicate-name" ? a.ignoredPath : a.path;
      const bPath = b.type === "duplicate-name" ? b.ignoredPath : b.path;
      return aPath.localeCompare(bPath);
    }),
  };
}

export function discoverRepoAiChecks(projectDir: string): RepoAiCheckDiscovery {
  const allCandidates: ParsedCheckCandidate[] = [];
  const diagnostics: RepoAiCheckDiagnostic[] = [];
  for (const root of CHECK_ROOTS) {
    const discovered = discoverRoot(projectDir, root);
    allCandidates.push(...discovered.candidates);
    diagnostics.push(...discovered.diagnostics);
  }

  const deduped = chooseDuplicateWinners(allCandidates);
  diagnostics.push(...deduped.diagnostics);
  return {
    checks: withStableIds(deduped.winners),
    diagnostics: diagnostics.sort((a, b) => {
      if (a.type !== b.type) return a.type.localeCompare(b.type);
      const aPath = a.type === "duplicate-name" ? a.ignoredPath : a.path;
      const bPath = b.type === "duplicate-name" ? b.ignoredPath : b.path;
      return aPath.localeCompare(bPath);
    }),
  };
}
