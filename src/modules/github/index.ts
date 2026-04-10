/**
 * GitHub module — typed REST API tools for PR and issue operations.
 *
 * Tools:
 *   github_create_pr     — create a pull request
 *   github_get_pr        — get PR details and CI check statuses
 *   github_list_issues   — list open issues with optional label filter
 *   github_list_prs      — list pull requests with optional state/branch filter
 *   github_comment       — add a comment to a PR or issue
 *   github_merge_pr      — merge a PR (squash/merge/rebase)
 *   github_close_pr      — close a PR without merging
 *   github_create_issue  — create a new issue with title, body, labels, and assignees
 *   github_update_issue  — update an existing issue's state, title, or body
 *   github_add_label     — add a label to a PR or issue
 *   github_remove_label  — remove a label from a PR or issue
 *
 * Config (under modules.github):
 *   token:           GitHub PAT or $ENV_VAR reference. Required.
 *   repo:            default owner/repo (e.g. "owner/repo"). Falls back to git remote.
 *   requireApproval: tool names requiring approval before execution.
 *                    Default: ["github_merge_pr", "github_close_pr",
 *                    "github_create_issue", "github_update_issue",
 *                    "github_add_label", "github_remove_label"]. These tools are
 *                    also classified as dangerous by guardrails so they are queued in
 *                    autonomous mode.
 *
 * Uses GitHub REST API v2022-11-28 via fetch; no npm dependencies.
 * Token is never logged or included in error messages.
 */

import type { KotaModule, ModuleContext, ToolDef } from "../../core/modules/module-types.js";
import type { GitHubConfig } from "./github-auth.js";
import { githubFetch, resolveRepo, resolveToken } from "./github-auth.js";
import { makeIssueTools } from "./github-issues.js";
import { makePrTools } from "./github-pr.js";
import { GitHubTaskProvider } from "./task-provider.js";

const githubModule: KotaModule = {
  name: "github",
  version: "1.0.0",
  description: "GitHub REST API tools for PR and issue operations",

  tools(ctx: ModuleContext): ToolDef[] {
    const config = ctx.getModuleConfig<GitHubConfig>();
    if (!config?.token) {
      ctx.log.warn(
        "GitHub module: modules.github.token is required but missing — module inactive",
      );
      return [];
    }

    const token = resolveToken(config.token);
    if (!token) {
      ctx.log.warn(
        `GitHub module: token env var "${config.token}" is not set — module inactive`,
      );
      return [];
    }

    const defaultRepo = resolveRepo(config.repo);

    return [
      ...makePrTools(token, defaultRepo),
      ...makeIssueTools(token, defaultRepo),
    ];
  },

  async onLoad(ctx: ModuleContext): Promise<void> {
    const config = ctx.getModuleConfig<GitHubConfig>();
    if (!config?.taskProvider?.enabled) return;

    if (!config.token) {
      ctx.log.warn(
        "GitHub task provider: modules.github.token is required but missing — provider inactive",
      );
      return;
    }
    const token = resolveToken(config.token);
    if (!token) {
      ctx.log.warn(
        `GitHub task provider: token env var "${config.token}" is not set — provider inactive`,
      );
      return;
    }
    const repo = resolveRepo(config.repo);
    if (!repo) {
      ctx.log.warn(
        "GitHub task provider: no repository configured — set modules.github.repo or ensure git remote origin is a GitHub URL",
      );
      return;
    }

    const boundFetch = (method: string, path: string, body?: unknown) =>
      githubFetch(token, method, path, body);

    const provider = new GitHubTaskProvider(repo, config.taskProvider, boundFetch);
    try {
      await provider.init();
      ctx.registerProvider("task", provider);
      ctx.log.info("GitHub Issues task provider registered");
    } catch (err) {
      ctx.log.warn(
        `GitHub task provider: init failed — ${(err as Error).message}`,
      );
    }
  },
};

export default githubModule;
