/**
 * JiraTaskProvider — TaskProvider backed by Jira Cloud Issues.
 *
 * Implements the TaskProvider interface using Jira's REST API v3 as the
 * authoritative source. Issues are fetched at init() and cached in memory.
 * Transitions are looked up by name at init() and cached.
 * Mutations (claim, complete, add) update the cache synchronously and fire
 * Jira API calls asynchronously.
 *
 * - list()   → issues from configured project matching JQL filter
 * - claim    → update(id, {status:"in_progress"}) → transitions issue + assigns to user
 * - complete → update(id, {status:"done"}) → transitions issue to done state
 * - add()    → creates a Jira issue; cache entry uses a temp negative ID until created
 */

import type { Task, TaskPriority, TaskStatus } from "#core/daemon/task-store-types.js";
import type { TaskProvider } from "#core/modules/provider-types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export type JiraTaskProviderConfig = {
  /** Enable this provider. Must be explicitly true to activate. */
  enabled: boolean;
  /** Jira project key (e.g. "ENG"). Required. */
  projectKey: string;
  /** JQL filter appended to the base query. Default: no extra filter. */
  jqlFilter?: string;
  /** Transition name for "in progress". Default: "In Progress". */
  inProgressTransition?: string;
  /** Transition name for "done". Default: "Done". */
  doneTransition?: string;
  /** Assign issue to authenticated user on claim. Default: true. */
  claimOnStart?: boolean;
};

// ─── Jira API types ───────────────────────────────────────────────────────────

type JiraIssue = {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: { content?: Array<{ content?: Array<{ text?: string }> }> } | null;
    priority?: { name: string } | null;
    status: { name: string };
    components?: Array<{ name: string }>;
  };
};

type JiraTransition = { id: string; name: string };

export type JiraFetchFn = (
  path: string,
  options?: { method?: string; body?: unknown },
) => Promise<unknown>;

// Jira priority name → KOTA priority
const JIRA_PRIORITY_MAP: Record<string, TaskPriority | undefined> = {
  Highest: "high",
  High: "high",
  Medium: "medium",
  Low: "low",
  Lowest: "low",
};

// ─── Provider ────────────────────────────────────────────────────────────────

export class JiraTaskProvider implements TaskProvider {
  private cache: Task[] = [];
  private jiraKeys = new Map<number, string>(); // numeric ID → Jira issue key
  private transitionIds = new Map<string, string>(); // transition name → transition ID
  private accountId = "";
  private counter = 1;
  private localCounter = -1;

  constructor(
    private readonly config: JiraTaskProviderConfig,
    private readonly fetch: JiraFetchFn,
  ) {}

  /** Fetch account info, transitions, and open issues from Jira. Call once at startup. */
  async init(): Promise<void> {
    // Get the authenticated user's accountId for assigning issues
    const myself = await this.fetch("/rest/api/3/myself") as { accountId: string };
    this.accountId = myself.accountId;

    // Load transitions from an arbitrary issue to cache common transition IDs.
    // Jira transitions are per-issue-type/workflow but typically consistent for a project.
    // We look them up per-issue lazily during mutations if needed.
    // For init, we do a search first to get issue keys, then fetch transitions from one.
    const jql = this.buildJql();
    const searchResult = await this.fetch(
      `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,description,priority,status,components`,
    ) as { issues: JiraIssue[]; errorMessages?: string[] };

    if (searchResult.errorMessages?.length) {
      throw new Error(`Jira task provider: search failed — ${searchResult.errorMessages.join(", ")}`);
    }

    const issues = searchResult.issues ?? [];
    this.cache = issues.map((i) => this.issueToTask(i));

    // Pre-cache transitions from the first issue if available
    if (issues.length > 0) {
      await this.cacheTransitionsForIssue(issues[0].key);
    }
  }

  // ─── TaskProvider interface ───────────────────────────────────────────────

  list(): Task[] {
    return [...this.cache];
  }

  active(): Task[] {
    return this.cache.filter((t) => t.status !== "done");
  }

  get(id: number): Task | undefined {
    return this.cache.find((t) => t.id === id);
  }

  isEmpty(): boolean {
    return this.cache.length === 0;
  }

  count(): number {
    return this.cache.length;
  }

  add(
    taskText: string,
    opts?: {
      parent_id?: number;
      priority?: TaskPriority;
      blocked_by?: number[];
      notes?: string;
    },
  ): Task {
    const tempId = this.localCounter--;
    const newTask: Task = {
      id: tempId,
      task: taskText,
      status: "pending",
      created: new Date().toISOString(),
    };
    if (opts?.priority) newTask.priority = opts.priority;
    if (opts?.notes) newTask.notes = opts.notes;
    if (opts?.blocked_by?.length) newTask.blocked_by = opts.blocked_by;

    this.cache.push(newTask);

    const body: Record<string, unknown> = {
      fields: {
        project: { key: this.config.projectKey },
        summary: taskText,
        issuetype: { name: "Task" },
      },
    };
    if (opts?.notes) {
      (body.fields as Record<string, unknown>).description = {
        type: "doc",
        version: 1,
        content: [{ type: "paragraph", content: [{ type: "text", text: opts.notes }] }],
      };
    }

    this.fetch("/rest/api/3/issue", { method: "POST", body })
      .then((res) => {
        const created = res as { id?: string; key?: string };
        if (created.key) {
          const entry = this.cache.find((t) => t.id === tempId);
          if (entry) {
            const newId = this.counter++;
            this.jiraKeys.set(newId, created.key);
            entry.id = newId;
          }
        }
      })
      .catch(() => {
        // Best-effort; task remains with temp ID in local cache.
      });

    return newTask;
  }

  update(
    id: number,
    changes: {
      status?: TaskStatus;
      priority?: TaskPriority;
      blocked_by?: number[];
      notes?: string;
    },
  ): Task {
    const task = this.cache.find((t) => t.id === id);
    if (!task) throw new Error(`Task #${id} not found`);

    if (changes.status && changes.status !== task.status) {
      task.status = changes.status;
      const issueKey = this.jiraKeys.get(id);

      if (issueKey) {
        if (changes.status === "in_progress") {
          const transitionName = this.config.inProgressTransition ?? "In Progress";
          this.applyTransition(issueKey, transitionName)
            .then(() => {
              if (this.config.claimOnStart !== false && this.accountId) {
                return this.fetch(`/rest/api/3/issue/${issueKey}/assignee`, {
                  method: "PUT",
                  body: { accountId: this.accountId },
                });
              }
            })
            .catch(() => {});
        } else if (changes.status === "done") {
          task.completed = new Date().toISOString();
          const transitionName = this.config.doneTransition ?? "Done";
          this.applyTransition(issueKey, transitionName).catch(() => {});
        }
      }
    }

    if (changes.priority !== undefined) task.priority = changes.priority;
    if (changes.notes !== undefined) task.notes = changes.notes;
    if (changes.blocked_by !== undefined) {
      task.blocked_by = changes.blocked_by.length > 0 ? changes.blocked_by : undefined;
    }

    return task;
  }

  clear(): void {
    // No-op: do not delete Jira issues when clearing local state.
  }

  archiveCompleted(): number {
    const done = this.cache.filter((t) => t.status === "done");
    this.cache = this.cache.filter((t) => t.status !== "done");
    return done.length;
  }

  getActiveSummary(): string | null {
    const active = this.cache.filter((t) => t.status !== "done");
    if (active.length === 0) return null;
    const inProgress = active.filter((t) => t.status === "in_progress");
    const pending = active.filter((t) => t.status === "pending");
    const parts: string[] = [];
    if (inProgress.length > 0) {
      parts.push(
        `${inProgress.length} in progress: ${inProgress.map((t) => `"${t.task}"`).join(", ")}`,
      );
    }
    if (pending.length > 0) {
      const preview = pending.slice(0, 3).map((t) => `"${t.task}"`).join(", ");
      const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : "";
      parts.push(`${pending.length} pending: ${preview}${more}`);
    }
    return parts.join("; ");
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private buildJql(): string {
    const parts = [`project = "${this.config.projectKey}"`, `statusCategory != Done`];
    if (this.config.jqlFilter) parts.push(this.config.jqlFilter);
    return parts.join(" AND ");
  }

  private issueToTask(issue: JiraIssue): Task {
    const numericId = this.counter++;
    this.jiraKeys.set(numericId, issue.key);

    const priorityName = issue.fields.priority?.name;
    const priority = priorityName ? JIRA_PRIORITY_MAP[priorityName] : undefined;

    const task: Task = {
      id: numericId,
      task: issue.fields.summary,
      status: "pending",
      created: new Date().toISOString(),
    };
    if (priority) task.priority = priority;

    const descText = this.extractDescriptionText(issue.fields.description);
    if (descText) task.notes = descText;

    return task;
  }

  private extractDescriptionText(
    description?: { content?: Array<{ content?: Array<{ text?: string }> }> } | null,
  ): string | undefined {
    if (!description?.content) return undefined;
    const texts: string[] = [];
    for (const block of description.content) {
      if (!block.content) continue;
      for (const inline of block.content) {
        if (inline.text) texts.push(inline.text);
      }
    }
    const full = texts.join(" ").trim();
    if (!full) return undefined;
    return full.length > 500 ? full.slice(0, 497) + "..." : full;
  }

  private async cacheTransitionsForIssue(issueKey: string): Promise<void> {
    const res = await this.fetch(`/rest/api/3/issue/${issueKey}/transitions`) as {
      transitions?: JiraTransition[];
    };
    for (const t of res.transitions ?? []) {
      this.transitionIds.set(t.name, t.id);
    }
  }

  private async applyTransition(issueKey: string, transitionName: string): Promise<void> {
    let transitionId = this.transitionIds.get(transitionName);
    if (!transitionId) {
      await this.cacheTransitionsForIssue(issueKey);
      transitionId = this.transitionIds.get(transitionName);
    }
    if (!transitionId) return;
    await this.fetch(`/rest/api/3/issue/${issueKey}/transitions`, {
      method: "POST",
      body: { transition: { id: transitionId } },
    });
  }
}
