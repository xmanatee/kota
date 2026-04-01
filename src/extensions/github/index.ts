/**
 * GitHub extension — typed REST API tools for PR and issue operations.
 *
 * Tools:
 *   github_create_pr   — create a pull request
 *   github_get_pr      — get PR details and CI check statuses
 *   github_list_issues — list open issues with optional label filter
 *   github_comment     — add a comment to a PR or issue
 *   github_merge_pr    — merge a PR (squash/merge/rebase)
 *
 * Config (under extensions.github):
 *   token:           GitHub PAT or $ENV_VAR reference. Required.
 *   repo:            default owner/repo (e.g. "owner/repo"). Falls back to git remote.
 *   requireApproval: tool names requiring approval before execution.
 *                    Default: ["github_merge_pr"]. These tools are also classified
 *                    as dangerous by guardrails so they are queued in autonomous mode.
 *
 * Uses GitHub REST API v2022-11-28 via fetch; no npm dependencies.
 * Token is never logged or included in error messages.
 */

import { execSync } from "node:child_process";
import type { ExtensionContext, KotaExtension, ToolDef } from "../../extension-types.js";
import type { ToolResult } from "../../tools/tool-result.js";

// ─── Config ──────────────────────────────────────────────────────────────────

type GitHubConfig = {
  /** GitHub personal access token or "$ENV_VAR" reference. Required. */
  token: string;
  /** Default owner/repo, e.g. "owner/repo". Falls back to git remote. */
  repo?: string;
  /** Tools requiring explicit approval before execution. Default: ["github_merge_pr"]. */
  requireApproval?: string[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveToken(raw: string): string {
  if (raw.startsWith("$")) {
    return process.env[raw.slice(1)] ?? "";
  }
  return raw;
}

function resolveRepo(configured?: string): string | null {
  if (configured) return configured;
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const m = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

type GitHubResponse = {
  ok: boolean;
  status: number;
  data: unknown;
};

async function githubFetch(
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
      "User-Agent": "kota/github-extension",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function apiError(action: string, status: number, data: unknown): ToolResult {
  const msg = (data as { message?: string })?.message ?? JSON.stringify(data);
  return { content: `GitHub API error (${status}) during ${action}: ${msg}`, is_error: true };
}

// ─── Tool factories ───────────────────────────────────────────────────────────

function makeCreatePr(token: string, defaultRepo: string | null): ToolDef {
  return {
    tool: {
      name: "github_create_pr",
      description:
        "Create a GitHub pull request. Returns the PR number and URL. " +
        "Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "PR title" },
          head: { type: "string", description: "Branch to merge from (e.g. feature/my-branch)" },
          base: { type: "string", description: "Branch to merge into (e.g. main)" },
          body: { type: "string", description: "PR description (Markdown)" },
          draft: { type: "boolean", description: "Open as draft PR" },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: ["title", "head", "base"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured. Set extensions.github.repo or ensure git remote origin is a GitHub URL.", is_error: true };

      const res = await githubFetch(token, "POST", `/repos/${repo}/pulls`, {
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body ?? "",
        draft: input.draft ?? false,
      });
      if (!res.ok) return apiError("create PR", res.status, res.data);

      const pr = res.data as { number: number; html_url: string; title: string };
      return { content: `Created PR #${pr.number}: ${pr.title}\n${pr.html_url}` };
    },
  };
}

function makeGetPr(token: string, defaultRepo: string | null): ToolDef {
  return {
    tool: {
      name: "github_get_pr",
      description:
        "Get pull request details and CI check statuses by PR number.",
      input_schema: {
        type: "object" as const,
        properties: {
          number: { type: "number", description: "PR number" },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: ["number"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured.", is_error: true };

      const prNum = input.number as number;
      const prRes = await githubFetch(token, "GET", `/repos/${repo}/pulls/${prNum}`);

      if (!prRes.ok) return apiError("get PR", prRes.status, prRes.data);

      const pr = prRes.data as {
        number: number;
        title: string;
        state: string;
        draft: boolean;
        html_url: string;
        head: { sha: string; ref: string };
        base: { ref: string };
        mergeable: boolean | null;
        body: string | null;
      };

      // Fetch CI checks for the head commit
      const checksData = await githubFetch(
        token,
        "GET",
        `/repos/${repo}/commits/${pr.head.sha}/check-runs`,
      );

      const lines = [
        `PR #${pr.number}: ${pr.title}`,
        `State: ${pr.state}${pr.draft ? " (draft)" : ""}`,
        `${pr.head.ref} → ${pr.base.ref}`,
        `URL: ${pr.html_url}`,
        pr.mergeable !== null ? `Mergeable: ${pr.mergeable}` : "",
      ].filter(Boolean);

      if (checksData.ok) {
        const checks = checksData.data as {
          check_runs?: Array<{ name: string; status: string; conclusion: string | null }>;
        };
        const runs = checks.check_runs ?? [];
        if (runs.length > 0) {
          lines.push(
            "",
            "CI checks:",
            ...runs.map(
              (r) =>
                `  ${r.name}: ${r.status}${r.conclusion ? ` (${r.conclusion})` : ""}`,
            ),
          );
        }
      }

      return { content: lines.join("\n") };
    },
  };
}

function makeListIssues(token: string, defaultRepo: string | null): ToolDef {
  return {
    tool: {
      name: "github_list_issues",
      description: "List GitHub issues with optional label filter.",
      input_schema: {
        type: "object" as const,
        properties: {
          labels: { type: "string", description: "Comma-separated label names to filter by" },
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description: "Issue state filter (default: open)",
          },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: [],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured.", is_error: true };

      const params = new URLSearchParams();
      params.set("state", (input.state as string | undefined) ?? "open");
      params.set("per_page", "30");
      if (input.labels) params.set("labels", input.labels as string);

      const res = await githubFetch(token, "GET", `/repos/${repo}/issues?${params}`);
      if (!res.ok) return apiError("list issues", res.status, res.data);

      const issues = res.data as Array<{
        number: number;
        title: string;
        html_url: string;
        labels: Array<{ name: string }>;
        pull_request?: unknown;
      }>;

      // GitHub issues endpoint also returns PRs; filter those out
      const filtered = issues.filter((i) => !i.pull_request);
      if (filtered.length === 0) return { content: "No issues found." };

      const lines = filtered.map(
        (i) =>
          `#${i.number}: ${i.title}${i.labels.length > 0 ? ` [${i.labels.map((l) => l.name).join(", ")}]` : ""}`,
      );
      return { content: `${filtered.length} issue(s):\n${lines.join("\n")}` };
    },
  };
}

function makeComment(token: string, defaultRepo: string | null): ToolDef {
  return {
    tool: {
      name: "github_comment",
      description:
        "Add a comment to a GitHub issue or pull request. " +
        "Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          number: { type: "number", description: "Issue or PR number" },
          body: { type: "string", description: "Comment text (Markdown)" },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: ["number", "body"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured.", is_error: true };

      const res = await githubFetch(
        token,
        "POST",
        `/repos/${repo}/issues/${input.number as number}/comments`,
        { body: input.body },
      );
      if (!res.ok) return apiError("create comment", res.status, res.data);

      const comment = res.data as { id: number; html_url: string };
      return { content: `Comment posted (ID: ${comment.id})\n${comment.html_url}` };
    },
  };
}

function makeMergePr(token: string, defaultRepo: string | null): ToolDef {
  return {
    tool: {
      name: "github_merge_pr",
      description:
        "Merge a GitHub pull request. Requires operator approval before execution " +
        "(classified as dangerous; queued for approval in autonomous mode).",
      input_schema: {
        type: "object" as const,
        properties: {
          number: { type: "number", description: "PR number" },
          merge_method: {
            type: "string",
            enum: ["squash", "merge", "rebase"],
            description: "Merge strategy (default: squash)",
          },
          commit_title: { type: "string", description: "Title for the merge commit (optional)" },
          commit_message: {
            type: "string",
            description: "Message for the merge commit (optional)",
          },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: ["number"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured.", is_error: true };

      const body: Record<string, unknown> = {
        merge_method: (input.merge_method as string | undefined) ?? "squash",
      };
      if (input.commit_title) body.commit_title = input.commit_title;
      if (input.commit_message) body.commit_message = input.commit_message;

      const res = await githubFetch(
        token,
        "PUT",
        `/repos/${repo}/pulls/${input.number as number}/merge`,
        body,
      );
      if (!res.ok) return apiError("merge PR", res.status, res.data);

      const merged = res.data as { sha: string; merged: boolean; message: string };
      return {
        content: `PR #${input.number as number} merged.\nSHA: ${merged.sha}\n${merged.message}`,
      };
    },
  };
}

// ─── Extension ───────────────────────────────────────────────────────────────

const githubModule: KotaExtension = {
  name: "github",
  version: "1.0.0",
  description: "GitHub REST API tools for PR and issue operations",

  tools(ctx: ExtensionContext): ToolDef[] {
    const config = ctx.getExtensionConfig<GitHubConfig>();
    if (!config?.token) {
      ctx.log.warn(
        "GitHub extension: extensions.github.token is required but missing — extension inactive",
      );
      return [];
    }

    const token = resolveToken(config.token);
    if (!token) {
      ctx.log.warn(
        `GitHub extension: token env var "${config.token}" is not set — extension inactive`,
      );
      return [];
    }

    const defaultRepo = resolveRepo(config.repo);

    return [
      makeCreatePr(token, defaultRepo),
      makeGetPr(token, defaultRepo),
      makeListIssues(token, defaultRepo),
      makeComment(token, defaultRepo),
      makeMergePr(token, defaultRepo),
    ];
  },
};

export default githubModule;
