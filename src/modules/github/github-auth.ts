import { execSync } from "node:child_process";
import type { ToolResult } from "#core/tools/tool-result.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export type GitHubConfig = {
  /** GitHub personal access token or "$ENV_VAR" reference. Required. */
  token: string;
  /** Default owner/repo, e.g. "owner/repo". Falls back to git remote. */
  repo?: string;
  /** Tools requiring explicit approval before execution. */
  requireApproval?: string[];
  /** Optional GitHub Issues task provider configuration. */
  taskProvider?: import("./task-provider.js").GitHubTaskProviderConfig;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type GitHubResponse = {
  ok: boolean;
  status: number;
  data: unknown;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function resolveToken(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

export function resolveRepo(configured?: string): string | null {
  if (configured) return configured;
  try {
    const url = execSync("git remote get-url origin", {
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export async function githubFetch(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<GitHubResponse> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "kota/github-module",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

export function apiError(action: string, status: number, data: unknown): ToolResult {
  const msg = (data as { message?: string })?.message ?? JSON.stringify(data);
  return { content: `GitHub API error (${status}) during ${action}: ${msg}`, is_error: true };
}
