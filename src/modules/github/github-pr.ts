import type { ToolDef } from "../../module-types.js";
import type { ToolResult } from "../../tools/tool-result.js";
import { apiError, githubFetch } from "./github-auth.js";

function makeCreatePr(token: string, defaultRepo: string | null): ToolDef {
  return {
    risk: "dangerous",
    kind: "action",
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
      if (!repo) return { content: "No repository configured. Set modules.github.repo or ensure git remote origin is a GitHub URL.", is_error: true };

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
    risk: "safe",
    kind: "discovery",
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

function makeListPrs(token: string, defaultRepo: string | null): ToolDef {
  return {
    risk: "safe",
    kind: "discovery",
    tool: {
      name: "github_list_prs",
      description:
        "List GitHub pull requests with optional state and branch filters. " +
        "Returns number, title, branch, author, created_at, url, and draft status.",
      input_schema: {
        type: "object" as const,
        properties: {
          state: {
            type: "string",
            enum: ["open", "closed", "all"],
            description: "PR state filter (default: open)",
          },
          head: {
            type: "string",
            description: "Filter by head branch name (e.g. feature/my-branch)",
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
      if (input.head) params.set("head", input.head as string);

      const res = await githubFetch(token, "GET", `/repos/${repo}/pulls?${params}`);
      if (!res.ok) return apiError("list PRs", res.status, res.data);

      const prs = res.data as Array<{
        number: number;
        title: string;
        html_url: string;
        draft: boolean;
        created_at: string;
        head: { ref: string };
        user: { login: string };
      }>;

      if (prs.length === 0) return { content: "No pull requests found." };

      const lines = prs.map(
        (pr) =>
          `#${pr.number}: ${pr.title}${pr.draft ? " [draft]" : ""}\n` +
          `  branch: ${pr.head.ref} | author: ${pr.user.login} | created: ${pr.created_at}\n` +
          `  ${pr.html_url}`,
      );
      return { content: `${prs.length} PR(s):\n${lines.join("\n")}` };
    },
  };
}

function makeMergePr(token: string, defaultRepo: string | null): ToolDef {
  return {
    risk: "dangerous",
    kind: "action",
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

function makeClosePr(token: string, defaultRepo: string | null): ToolDef {
  return {
    risk: "dangerous",
    kind: "action",
    tool: {
      name: "github_close_pr",
      description:
        "Close a GitHub pull request without merging. " +
        "Requires operator approval in autonomous mode (classified as dangerous).",
      input_schema: {
        type: "object" as const,
        properties: {
          number: { type: "number", description: "PR number to close" },
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
      const res = await githubFetch(token, "PATCH", `/repos/${repo}/pulls/${prNum}`, {
        state: "closed",
      });
      if (!res.ok) return apiError("close PR", res.status, res.data);

      const pr = res.data as { number: number; state: string; html_url: string };
      return { content: `PR #${pr.number} closed.\n${pr.html_url}` };
    },
  };
}

export function makePrTools(token: string, defaultRepo: string | null): ToolDef[] {
  return [
    makeCreatePr(token, defaultRepo),
    makeGetPr(token, defaultRepo),
    makeListPrs(token, defaultRepo),
    makeMergePr(token, defaultRepo),
    makeClosePr(token, defaultRepo),
  ];
}
