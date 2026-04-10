/**
 * LinearTaskProvider — TaskProvider backed by Linear Issues.
 *
 * Implements the TaskProvider interface using Linear's GraphQL API as the
 * authoritative source. Issues are fetched at init() and cached in memory.
 * Mutations (claim, complete, add) update the cache synchronously and fire
 * Linear API calls asynchronously.
 *
 * - list()   → open issues matching label filter, excluding started/completed/cancelled states
 * - claim    → update(id, {status:"in_progress"}) → transitions issue to inProgressState
 * - complete → update(id, {status:"done"}) → transitions issue to doneState + adds comment
 * - add()    → creates a Linear issue; cache entry uses a temp negative ID until created
 */

import type { Task, TaskPriority, TaskStatus } from "../../core/daemon/task-store-types.js";
import type { TaskProvider } from "../../core/modules/provider-types.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export type LinearTaskProviderConfig = {
  /** Enable this provider. Must be explicitly true to activate. */
  enabled: boolean;
  /** Linear team key (e.g. "ENG"). Required. */
  teamKey: string;
  /** Label that issues must have to be included in list(). Default: no filter. */
  labelFilter?: string;
  /** Workflow state name for "in progress". Default: "In Progress". */
  inProgressState?: string;
  /** Workflow state name for "done". Default: "Done". */
  doneState?: string;
};

// ─── Linear API types ─────────────────────────────────────────────────────────

type LinearState = { id: string; name: string; type: string };

type LinearIssue = {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  state: LinearState;
  labels: { nodes: Array<{ name: string }> };
};

export type LinearFetchFn = (
  query: string,
  variables?: Record<string, unknown>,
) => Promise<{ data: Record<string, unknown>; errors?: Array<{ message: string }> }>;

// Linear priority field: 0=no priority, 1=urgent, 2=high, 3=medium, 4=low
const LINEAR_PRIORITY_MAP: Record<number, TaskPriority | undefined> = {
  0: undefined,
  1: "high",
  2: "high",
  3: "medium",
  4: "low",
};

// ─── Provider ────────────────────────────────────────────────────────────────

export class LinearTaskProvider implements TaskProvider {
  private cache: Task[] = [];
  private linearIds = new Map<number, string>(); // numeric ID → Linear UUID
  private stateIds = new Map<string, string>(); // state name → Linear UUID
  private teamId = "";
  private counter = 1;
  private localCounter = -1;

  constructor(
    private readonly config: LinearTaskProviderConfig,
    private readonly fetch: LinearFetchFn,
  ) {}

  /** Fetch team, workflow states, and open issues from Linear. Call once at startup. */
  async init(): Promise<void> {
    const teamRes = await this.fetch(
      `query GetTeam($key: String!) {
        teams(filter: { key: { eq: $key } }) {
          nodes {
            id
            states { nodes { id name type } }
          }
        }
      }`,
      { key: this.config.teamKey },
    );
    this.checkErrors(teamRes, "get team");

    const teams = (teamRes.data.teams as { nodes: Array<{ id: string; states: { nodes: LinearState[] } }> }).nodes;
    if (!teams.length) {
      throw new Error(`Linear task provider: team "${this.config.teamKey}" not found`);
    }
    this.teamId = teams[0].id;
    for (const state of teams[0].states.nodes) {
      this.stateIds.set(state.name, state.id);
    }

    const issuesRes = await this.fetch(
      `query TeamIssues($teamId: String!) {
        issues(filter: {
          team: { id: { eq: $teamId } }
          state: { type: { notIn: ["started", "completed", "cancelled"] } }
        }, first: 100) {
          nodes {
            id title description priority
            state { id name type }
            labels { nodes { name } }
          }
        }
      }`,
      { teamId: this.teamId },
    );
    this.checkErrors(issuesRes, "fetch issues");

    let issues = (issuesRes.data.issues as { nodes: LinearIssue[] }).nodes;
    if (this.config.labelFilter) {
      const filter = this.config.labelFilter;
      issues = issues.filter((i) => i.labels.nodes.some((l) => l.name === filter));
    }

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

    this.fetch(
      `mutation CreateIssue($teamId: String!, $title: String!, $description: String, $labelIds: [String!]) {
        issueCreate(input: { teamId: $teamId, title: $title, description: $description, labelIds: $labelIds }) {
          success
          issue { id }
        }
      }`,
      {
        teamId: this.teamId,
        title: taskText,
        description: opts?.notes ?? null,
        labelIds: labels.length > 0 ? labels : null,
      },
    )
      .then((res) => {
        if (res.errors?.length) return;
        const result = res.data.issueCreate as { success: boolean; issue?: { id: string } };
        if (result.success && result.issue) {
          const entry = this.cache.find((t) => t.id === tempId);
          if (entry) {
            const newId = this.counter++;
            this.linearIds.set(newId, result.issue.id);
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
      const linearId = this.linearIds.get(id);

      if (linearId) {
        if (changes.status === "in_progress") {
          const stateName = this.config.inProgressState ?? "In Progress";
          const stateId = this.stateIds.get(stateName);
          if (stateId) {
            this.fetch(
              `mutation UpdateIssueState($id: String!, $stateId: String!) {
                issueUpdate(id: $id, input: { stateId: $stateId }) { success }
              }`,
              { id: linearId, stateId },
            ).catch(() => {});
          }
        } else if (changes.status === "done") {
          task.completed = new Date().toISOString();
          const stateName = this.config.doneState ?? "Done";
          const stateId = this.stateIds.get(stateName);
          if (stateId) {
            this.fetch(
              `mutation UpdateIssueState($id: String!, $stateId: String!) {
                issueUpdate(id: $id, input: { stateId: $stateId }) { success }
              }`,
              { id: linearId, stateId },
            ).catch(() => {});
          }
          this.fetch(
            `mutation AddComment($issueId: String!, $body: String!) {
              commentCreate(input: { issueId: $issueId, body: $body }) { success }
            }`,
            { issueId: linearId, body: "Completed by KOTA autonomous builder." },
          ).catch(() => {});
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
    // No-op: do not delete Linear issues when clearing local state.
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

  private issueToTask(issue: LinearIssue): Task {
    const numericId = this.counter++;
    this.linearIds.set(numericId, issue.id);

    const priority = LINEAR_PRIORITY_MAP[issue.priority];
    const task: Task = {
      id: numericId,
      task: issue.title,
      status: "pending",
      created: new Date().toISOString(),
    };
    if (priority) task.priority = priority;
    if (issue.description) task.notes = issue.description;
    return task;
  }

  private checkErrors(
    res: { errors?: Array<{ message: string }> },
    action: string,
  ): void {
    if (res.errors?.length) {
      throw new Error(
        `Linear task provider: failed to ${action} — ${res.errors.map((e) => e.message).join(", ")}`,
      );
    }
  }
}
