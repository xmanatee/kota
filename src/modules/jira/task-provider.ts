/**
 * JiraTaskProvider — TaskProvider backed by Jira Cloud Issues.
 *
 * Implements the TaskProvider interface using Jira's REST API v3 as the
 * authoritative source. Issues are fetched at init() and cached in memory.
 * Transitions are looked up by name at init() and cached.
 * Mutations update the cache only after Jira acknowledges the durable write.
 *
 * - list()   → issues from configured project matching JQL filter
 * - claim    → update(id, {status:"in_progress"}) → transitions issue + assigns to user
 * - complete → update(id, {status:"done"}) → transitions issue to done state
 * - add()    → awaits Jira issue creation, then caches the acknowledged issue key
 */

import type { Task, TaskPriority, TaskStatus } from "#core/daemon/task-store-types.js";
import type { TaskMutationProvider, TaskProvider } from "#core/modules/provider-types.js";
import { RemoteTaskIdentity } from "#core/modules/remote-task-identity.js";
import type { OutboundHttpMethod } from "#core/outbound-http/index.js";

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
  options?: { method?: OutboundHttpMethod; body?: unknown },
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

export class JiraTaskProvider implements TaskProvider, TaskMutationProvider {
  private cache: Task[] = [];
  private readonly taskIdentity = new RemoteTaskIdentity("Jira");
  private jiraKeys = new Map<number, string>(); // numeric ID → Jira issue key
  private transitionIds = new Map<string, string>(); // transition name → transition ID
  private accountId = "";

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

  async add(
    taskText: string,
    opts?: {
      parent_id?: number;
      priority?: TaskPriority;
      blocked_by?: number[];
      notes?: string;
    },
  ): Promise<Task> {
    if (
      opts?.parent_id !== undefined ||
      opts?.blocked_by !== undefined ||
      opts?.priority !== undefined
    ) {
      throw new Error("Jira task provider does not support parent, dependency, or priority creation fields");
    }

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

    const created = await this.fetch("/rest/api/3/issue", {
      method: "POST",
      body,
    }) as { id?: string; key?: string };
    if (typeof created.key !== "string") {
      throw new Error("Jira task provider: issue creation response omitted the issue key");
    }

    const newId = this.taskIdentity.localId(created.id ?? created.key);
    this.jiraKeys.set(newId, created.key);
    const newTask: Task = {
      id: newId,
      task: taskText,
      status: "pending",
      created: new Date().toISOString(),
    };
    if (opts?.notes) newTask.notes = opts.notes;
    this.cache.push(newTask);
    return newTask;
  }

  async update(
    id: number,
    changes: {
      status?: TaskStatus;
      priority?: TaskPriority;
      blocked_by?: number[];
      notes?: string;
    },
  ): Promise<Task> {
    const task = this.cache.find((t) => t.id === id);
    if (!task) throw new Error(`Task #${id} not found`);
    if (
      changes.priority !== undefined ||
      changes.blocked_by !== undefined ||
      changes.notes !== undefined
    ) {
      throw new Error("Jira task provider only supports status updates");
    }

    if (changes.status && changes.status !== task.status) {
      const issueKey = this.jiraKeys.get(id);
      if (!issueKey) throw new Error(`Jira task provider: no remote issue for task #${id}`);
      if (changes.status === "pending") {
        throw new Error("Jira task provider does not support returning tasks to pending");
      }
      const transitionName = changes.status === "in_progress"
        ? this.config.inProgressTransition ?? "In Progress"
        : this.config.doneTransition ?? "Done";
      await this.applyTransition(issueKey, transitionName);
      if (
        changes.status === "in_progress" &&
        this.config.claimOnStart !== false &&
        this.accountId
      ) {
        await this.fetch(`/rest/api/3/issue/${issueKey}/assignee`, {
          method: "PUT",
          body: { accountId: this.accountId },
        });
      }
      task.status = changes.status;
      if (changes.status === "done") task.completed = new Date().toISOString();
    }

    return task;
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
    const numericId = this.taskIdentity.localId(issue.id);
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
    return full.length > 500 ? `${full.slice(0, 497)}...` : full;
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
    if (!transitionId) {
      throw new Error(`Jira task provider: transition "${transitionName}" was not found`);
    }
    await this.fetch(`/rest/api/3/issue/${issueKey}/transitions`, {
      method: "POST",
      body: { transition: { id: transitionId } },
    });
  }
}
