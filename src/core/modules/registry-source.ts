import { basename } from "node:path";

export type SourceType = "npm" | "url" | "github";

export type ParsedSource = {
  type: SourceType;
  /** npm package name, raw URL, or github owner/repo */
  identifier: string;
  /** Display name for the tool (derived from source) */
  name: string;
};

export type InstallResult = {
  name: string;
  source: SourceType;
  files: string[];
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
  try {
    const pathname = new URL(url).pathname;
    const filename = basename(pathname);
    if (!filename || filename === "/") return "tool";
    return filename.replace(/\.(js|mjs|ts)$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") || "tool";
  } catch {
    return "tool";
  }
}

function githubToName(repo: string): string {
  const parts = repo.split("/");
  return (parts[1] || parts[0]).replace(/^kota-/, "").replace(/^tool-/, "");
}
