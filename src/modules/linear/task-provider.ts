/**
 * LinearTaskProvider — TaskProvider backed by Linear Issues.
 *
 * Implements the TaskProvider interface using Linear's GraphQL API as the
 * authoritative source. Issues are fetched at init() and cached in memory.
 * Mutations update the cache only after Linear acknowledges the durable write.
 *
 * - list()   → open issues matching label filter, excluding started/completed/cancelled states
 * - claim    → update(id, {status:"in_progress"}) → transitions issue to inProgressState
 * - complete → update(id, {status:"done"}) → transitions issue to doneState + adds comment
 * - add()    → awaits Linear issue creation, then caches the acknowledged issue id
 */

import type { Task, TaskPriority, TaskStatus } from "#core/daemon/task-store-types.js";
import type { TaskMutationProvider, TaskProvider } from "#core/modules/provider-types.js";
import { RemoteTaskIdentity } from "#core/modules/remote-task-identity.js";

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

export class LinearTaskProvider implements TaskProvider, TaskMutationProvider {
  private cache: Task[] = [];
  private readonly taskIdentity = new RemoteTaskIdentity("Linear");
  private stateIds = new Map<string, string>(); // state name → Linear UUID
  private labelIds = new Map<string, string>(); // label name → Linear UUID
  private teamId = "";

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
            labels { nodes { id name } }
          }
        }
      }`,
      { key: this.config.teamKey },
    );
    this.checkErrors(teamRes, "get team");

    const teams = (teamRes.data.teams as {
      nodes: Array<{
        id: string;
        states: { nodes: LinearState[] };
        labels?: { nodes: Array<{ id: string; name: string }> };
      }>;
    }).nodes;
    if (!teams.length) {
      throw new Error(`Linear task provider: team "${this.config.teamKey}" not found`);
    }
    this.teamId = teams[0].id;
    for (const state of teams[0].states.nodes) {
      this.stateIds.set(state.name, state.id);
    }
    for (const label of teams[0].labels?.nodes ?? []) {
      this.labelIds.set(label.name, label.id);
    }
    if (this.config.labelFilter && !this.labelIds.has(this.config.labelFilter)) {
      throw new Error(
        `Linear task provider: label "${this.config.labelFilter}" was not found for team "${this.config.teamKey}"`,
      );
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
      throw new Error("Linear task provider does not support parent, dependency, or priority creation fields");
    }

    const labelId = this.config.labelFilter
      ? this.labelIds.get(this.config.labelFilter)
      : undefined;

    const response = await this.fetch(
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
        labelIds: labelId ? [labelId] : null,
      },
    );
    this.checkErrors(response, "create issue");
    const result = response.data.issueCreate as { success?: boolean; issue?: { id?: string } };
    if (result.success !== true || typeof result.issue?.id !== "string") {
      throw new Error("Linear task provider: issue creation was not acknowledged");
    }

    const newId = this.taskIdentity.localId(result.issue.id);
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
      throw new Error("Linear task provider only supports status updates");
    }

    if (changes.status && changes.status !== task.status) {
      const linearId = this.taskIdentity.remoteId(id);
      if (!linearId) throw new Error(`Linear task provider: no remote issue for task #${id}`);
      if (changes.status === "pending") {
        throw new Error("Linear task provider does not support returning tasks to pending");
      }
      const stateName = changes.status === "in_progress"
        ? this.config.inProgressState ?? "In Progress"
        : this.config.doneState ?? "Done";
      const stateId = this.stateIds.get(stateName);
      if (!stateId) {
        throw new Error(`Linear task provider: workflow state "${stateName}" was not found`);
      }
      const response = await this.fetch(
        `mutation UpdateIssueState($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) { success }
        }`,
        { id: linearId, stateId },
      );
      this.checkErrors(response, "update issue state");
      const result = response.data.issueUpdate as { success?: boolean };
      if (result.success !== true) {
        throw new Error("Linear task provider: state update was not acknowledged");
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

  private issueToTask(issue: LinearIssue): Task {
    const numericId = this.taskIdentity.localId(issue.id);

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
