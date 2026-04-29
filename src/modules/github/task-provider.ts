/**
 * GitHubTaskProvider — TaskProvider backed by GitHub Issues.
 *
 * Implements the TaskProvider interface using GitHub Issues as the authoritative
 * source. Issues are fetched at init() and cached in memory. Mutations (claim,
 * complete, add) update the cache synchronously and fire GitHub API calls
 * asynchronously.
 *
 * - list()   → open issues matching the configured label filter
 * - claim    → update(id, {status:"in_progress"}) → adds in-progress label
 * - complete → update(id, {status:"done"}) → closes issue + adds done label
 * - add()    → creates a GitHub issue; cache entry uses a temp negative ID until created
 */

import type { Task, TaskPriority, TaskStatus } from "#core/daemon/task-store-types.js";
import type { TaskProvider } from "#core/modules/provider-types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export type GitHubTaskProviderConfig = {
  /** Enable this provider. Must be explicitly true to activate. */
  enabled: boolean;
  /** Label that issues must have to be included in list(). Default: no filter. */
  labelFilter?: string;
  /** Label added when a task is claimed (set to in_progress). Default: "in-progress". */
  inProgressLabel?: string;
  /** Label added when a task is completed (set to done). Default: "kota-done". */
  doneLabel?: string;
  /**
   * Maps KOTA TaskPriority values to GitHub label names for import.
   * Reverse-mapped when reading issues: if an issue has one of the listed
   * label names, the corresponding KOTA priority is assigned.
   * Example: { "high": "priority:high", "medium": "priority:medium", "low": "priority:low" }
   */
  priorityLabels?: Partial<Record<TaskPriority, string>>;
};

// ─── GitHub API types ─────────────────────────────────────────────────────────

type GitHubIssue = {
  number: number;
  title: string;
  created_at: string;
  body: string | null;
  labels: Array<{ name: string }>;
  /** Marker the issues endpoint adds for issues that are actually pull requests. */
  pullRequest: boolean;
};

export type FetchFn = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ ok: boolean; status: number; data: unknown }>;

/**
 * Validate-and-narrow a raw GitHub issues-list response into typed `GitHubIssue`
 * records. Drops malformed entries rather than crashing the provider — a single
 * broken issue should not poison the queue. The boundary cast is contained to
 * this decoder; downstream consumers see the typed shape only.
 */
function decodeGitHubIssueList(data: unknown): GitHubIssue[] {
  if (!Array.isArray(data)) return [];
  const out: GitHubIssue[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as {
      number?: unknown;
      title?: unknown;
      created_at?: unknown;
      body?: unknown;
      labels?: unknown;
      pull_request?: unknown;
    };
    if (typeof r.number !== "number" || typeof r.title !== "string") continue;
    if (typeof r.created_at !== "string") continue;
    const body =
      typeof r.body === "string" ? r.body : r.body === null ? null : null;
    const labels: Array<{ name: string }> = [];
    if (Array.isArray(r.labels)) {
      for (const l of r.labels) {
        if (l && typeof l === "object") {
          const lr = l as { name?: unknown };
          if (typeof lr.name === "string") labels.push({ name: lr.name });
        }
      }
    }
    out.push({
      number: r.number,
      title: r.title,
      created_at: r.created_at,
      body,
      labels,
      pullRequest: r.pull_request != null,
    });
  }
  return out;
}

/** Decode the single-issue JSON returned by `POST /repos/.../issues`. */
function decodeGitHubIssueNumber(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const num = (data as { number?: unknown }).number;
  return typeof num === "number" ? num : null;
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class GitHubTaskProvider implements TaskProvider {
  private cache: Task[] = [];
  private localCounter = -1;

  constructor(
    private readonly repo: string,
    private readonly config: GitHubTaskProviderConfig,
    private readonly fetch: FetchFn,
  ) {}

  /** Fetch open issues from GitHub and populate the cache. Call once at startup. */
  async init(): Promise<void> {
    const params = new URLSearchParams();
    params.set("state", "open");
    params.set("per_page", "100");
    if (this.config.labelFilter) params.set("labels", this.config.labelFilter);

    const res = await this.fetch("GET", `/repos/${this.repo}/issues?${params}`);
    if (!res.ok) {
      throw new Error(
        `GitHub task provider: failed to fetch issues (HTTP ${res.status})`,
      );
    }

    const issues = decodeGitHubIssueList(res.data).filter((i) => !i.pullRequest);
    this.cache = issues.map((i) => this.issueToTask(i));
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

    const labels: string[] = [];
    if (this.config.labelFilter) labels.push(this.config.labelFilter);
    if (opts?.priority) {
      const priorityLabel = this.config.priorityLabels?.[opts.priority];
      if (priorityLabel) labels.push(priorityLabel);
    }

    const issueBody: Record<string, unknown> = { title: taskText };
    if (labels.length > 0) issueBody.labels = labels;
    if (opts?.notes) issueBody.body = opts.notes;

    this.fetch("POST", `/repos/${this.repo}/issues`, issueBody)
      .then((res) => {
        if (!res.ok) return;
        const issueNumber = decodeGitHubIssueNumber(res.data);
        if (issueNumber === null) return;
        const entry = this.cache.find((t) => t.id === tempId);
        if (entry) entry.id = issueNumber;
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
      const prev = task.status;
      task.status = changes.status;

      if (changes.status === "done") {
        task.completed = new Date().toISOString();
        if (id > 0) {
          const doneLabel = this.config.doneLabel ?? "kota-done";
          this.fetch("PATCH", `/repos/${this.repo}/issues/${id}`, {
            state: "closed",
          }).catch(() => {});
          this.fetch(
            "POST",
            `/repos/${this.repo}/issues/${id}/labels`,
            { labels: [doneLabel] },
          ).catch(() => {});
        }
      } else if (changes.status === "in_progress") {
        if (id > 0) {
          const inProgressLabel = this.config.inProgressLabel ?? "in-progress";
          this.fetch(
            "POST",
            `/repos/${this.repo}/issues/${id}/labels`,
            { labels: [inProgressLabel] },
          ).catch(() => {});
        }
      } else if (changes.status === "pending" && prev === "in_progress") {
        if (id > 0) {
          const inProgressLabel = this.config.inProgressLabel ?? "in-progress";
          this.fetch(
            "DELETE",
            `/repos/${this.repo}/issues/${id}/labels/${encodeURIComponent(inProgressLabel)}`,
          ).catch(() => {});
        }
      }
    }

    if (changes.priority !== undefined) task.priority = changes.priority;
    if (changes.notes !== undefined) task.notes = changes.notes;
    if (changes.blocked_by !== undefined) {
      task.blocked_by =
        changes.blocked_by.length > 0 ? changes.blocked_by : undefined;
    }

    return task;
  }

  clear(): void {
    // No-op: do not delete GitHub issues when clearing local state.
  }

  archiveCompleted(): number {
    const done = this.cache.filter((t) => t.status === "done");
    this.cache = this.cache.filter((t) => t.status !== "done");
    for (const task of done) {
      if (task.id > 0) {
        this.fetch("PATCH", `/repos/${this.repo}/issues/${task.id}`, {
          state: "closed",
        }).catch(() => {});
      }
    }
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
      const preview = pending
        .slice(0, 3)
        .map((t) => `"${t.task}"`)
        .join(", ");
      const more = pending.length > 3 ? ` (+${pending.length - 3} more)` : "";
      parts.push(`${pending.length} pending: ${preview}${more}`);
    }
    return parts.join("; ");
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private issueToTask(issue: GitHubIssue): Task {
    const labelNames = issue.labels.map((l) => l.name);

    const inProgressLabel = this.config.inProgressLabel ?? "in-progress";
    const status: TaskStatus = labelNames.includes(inProgressLabel)
      ? "in_progress"
      : "pending";

    const priority = this.resolvePriority(labelNames);

    const task: Task = {
      id: issue.number,
      task: issue.title,
      status,
      created: issue.created_at,
    };
    if (priority) task.priority = priority;
    if (issue.body) task.notes = issue.body;
    return task;
  }

  private resolvePriority(labelNames: string[]): TaskPriority | undefined {
    const priorityLabels = this.config.priorityLabels ?? {};
    const reversed: Record<string, TaskPriority> = {};
    for (const [priority, label] of Object.entries(priorityLabels)) {
      if (label) reversed[label] = priority as TaskPriority;
    }
    for (const name of labelNames) {
      if (reversed[name]) return reversed[name];
    }
    return undefined;
  }
}
