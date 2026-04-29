import type { ToolDef } from "#core/modules/module-types.js";
import { legacyEffect } from "#core/tools/effect.js";
import type { ToolResult } from "#core/tools/tool-result.js";
import { apiError, githubFetch } from "./github-auth.js";

function makeListIssues(token: string, defaultRepo: string | null): ToolDef {
  return {
    effect: legacyEffect({ risk: "safe", kind: "discovery", openWorld: true }),
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
    effect: legacyEffect({ risk: "dangerous", kind: "action", openWorld: true }),
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

function makeCreateIssue(token: string, defaultRepo: string | null): ToolDef {
  return {
    effect: legacyEffect({ risk: "dangerous", kind: "action", openWorld: true }),
    tool: {
      name: "github_create_issue",
      description:
        "Create a GitHub issue with title, optional body, labels, and assignees. " +
        "Returns the new issue number and URL. Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue description (Markdown)" },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Label names to apply",
          },
          assignees: {
            type: "array",
            items: { type: "string" },
            description: "GitHub usernames to assign",
          },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: ["title"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured.", is_error: true };

      const body: Record<string, unknown> = { title: input.title };
      if (input.body) body.body = input.body;
      if (Array.isArray(input.labels) && input.labels.length > 0) body.labels = input.labels;
      if (Array.isArray(input.assignees) && input.assignees.length > 0) body.assignees = input.assignees;

      const res = await githubFetch(token, "POST", `/repos/${repo}/issues`, body);
      if (!res.ok) return apiError("create issue", res.status, res.data);

      const issue = res.data as { number: number; html_url: string; title: string };
      return { content: `Created issue #${issue.number}: ${issue.title}\n${issue.html_url}` };
    },
  };
}

function makeUpdateIssue(token: string, defaultRepo: string | null): ToolDef {
  return {
    effect: legacyEffect({ risk: "dangerous", kind: "action", openWorld: true }),
    tool: {
      name: "github_update_issue",
      description:
        "Update an existing GitHub issue's state, title, or body by issue number. " +
        "Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          number: { type: "number", description: "Issue number" },
          state: {
            type: "string",
            enum: ["open", "closed"],
            description: "New issue state",
          },
          title: { type: "string", description: "New issue title" },
          body: { type: "string", description: "New issue body (Markdown)" },
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

      const body: Record<string, unknown> = {};
      if (input.state) body.state = input.state;
      if (input.title) body.title = input.title;
      if (input.body !== undefined) body.body = input.body;

      const res = await githubFetch(token, "PATCH", `/repos/${repo}/issues/${input.number as number}`, body);
      if (!res.ok) return apiError("update issue", res.status, res.data);

      const issue = res.data as { number: number; state: string; title: string; html_url: string };
      return { content: `Updated issue #${issue.number}: ${issue.title} (${issue.state})\n${issue.html_url}` };
    },
  };
}

function makeAddLabel(token: string, defaultRepo: string | null): ToolDef {
  return {
    effect: legacyEffect({ risk: "dangerous", kind: "action", openWorld: true }),
    tool: {
      name: "github_add_label",
      description:
        "Add a label to a GitHub issue or pull request by number. " +
        "Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          number: { type: "number", description: "Issue or PR number" },
          label: { type: "string", description: "Label name to add" },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: ["number", "label"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured.", is_error: true };

      const res = await githubFetch(
        token,
        "POST",
        `/repos/${repo}/issues/${input.number as number}/labels`,
        { labels: [input.label] },
      );
      if (!res.ok) return apiError("add label", res.status, res.data);

      const labels = res.data as Array<{ name: string }>;
      const names = labels.map((l) => l.name).join(", ");
      return { content: `Labels on #${input.number as number}: ${names}` };
    },
  };
}

function makeRemoveLabel(token: string, defaultRepo: string | null): ToolDef {
  return {
    effect: legacyEffect({ risk: "dangerous", kind: "action", openWorld: true }),
    tool: {
      name: "github_remove_label",
      description:
        "Remove a label from a GitHub issue or pull request by number. " +
        "Requires operator approval in autonomous mode.",
      input_schema: {
        type: "object" as const,
        properties: {
          number: { type: "number", description: "Issue or PR number" },
          label: { type: "string", description: "Label name to remove" },
          repo: {
            type: "string",
            description: "Repository as owner/repo. Defaults to configured or git remote.",
          },
        },
        required: ["number", "label"],
      },
    },
    async runner(input): Promise<ToolResult> {
      const repo = (input.repo as string | undefined) ?? defaultRepo;
      if (!repo) return { content: "No repository configured.", is_error: true };

      const label = encodeURIComponent(input.label as string);
      const res = await githubFetch(
        token,
        "DELETE",
        `/repos/${repo}/issues/${input.number as number}/labels/${label}`,
      );
      if (!res.ok) return apiError("remove label", res.status, res.data);

      return { content: `Label "${input.label as string}" removed from #${input.number as number}.` };
    },
  };
}

export function makeIssueTools(token: string, defaultRepo: string | null): ToolDef[] {
  return [
    makeListIssues(token, defaultRepo),
    makeComment(token, defaultRepo),
    makeCreateIssue(token, defaultRepo),
    makeUpdateIssue(token, defaultRepo),
    makeAddLabel(token, defaultRepo),
    makeRemoveLabel(token, defaultRepo),
  ];
}
