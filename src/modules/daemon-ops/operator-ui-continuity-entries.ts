import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import { type SurfaceRead, shortId } from "#core/daemon/ui-surface-builders.js";
import { redactSensitiveText } from "#core/evidence/policy.js";
import type { KnowledgeListResult } from "#modules/knowledge/client.js";
import type { MemoryListResult } from "#modules/memory/client.js";
import type { OwnerDecisionListResult } from "#modules/owner-decisions/client.js";
import type { RepoTaskListResult } from "#modules/repo-tasks/client.js";
import type { ModuleSetupStatusResponse } from "#modules/setup/client.js";
import type { WorkflowDefinitionsResult, WorkflowRunsListResult, WorkflowStatusSnapshot } from "#modules/workflow-ops/client.js";
import type { ContinuityEntry } from "./operator-ui-continuity-model.js";

function safeText(value: string, max = 120): string {
  return shortId(redactSensitiveText(value).replace(/\s+/g, " ").trim(), max);
}

function unavailable(label: string, message: string): ContinuityEntry {
  return {
    id: `unavailable-${label}`,
    name: `${label} unavailable`,
    state: "unavailable",
    detail: safeText(message),
    role: "warn",
  };
}

export function taskEntries(tasks: SurfaceRead<RepoTaskListResult>): {
  work: ContinuityEntry[];
  blocked: ContinuityEntry[];
} {
  if (!tasks.ok) return { work: [unavailable("tasks", tasks.message)], blocked: [] };
  const work: ContinuityEntry[] = [];
  const blocked: ContinuityEntry[] = [];
  for (const task of tasks.value.tasks) {
    const entry: ContinuityEntry = {
      id: `task-${task.id}`,
      name: safeText(task.title, 72),
      state: task.state,
      detail: `${task.priority}${task.waitingOnTasks.length > 0 ? `; waiting on ${task.waitingOnTasks.join(", ")}` : ""}`,
      role: task.state === "blocked" ? "warn" : "muted",
      route: { method: "GET", path: `/api/tasks/${encodeURIComponent(task.id)}`, label: "Open task" },
    };
    if (task.state === "blocked") blocked.push(entry);
    else work.push(entry);
  }
  return { work: work.slice(0, 5), blocked: blocked.slice(0, 5) };
}

export function runWorkEntries(status: SurfaceRead<WorkflowStatusSnapshot>): ContinuityEntry[] {
  if (!status.ok) return [unavailable("workflow status", status.message)];
  return status.value.activeRuns.slice(0, 3).map((run) => ({
    id: `active-run-${run.runId}`,
    name: safeText(run.workflow, 72),
    state: "active",
    detail: `started ${run.startedAt}; run ${shortId(run.runId, 24)}`,
    role: "info" as const,
    route: { method: "GET", path: `/workflow/runs/${encodeURIComponent(run.runId)}`, label: "Open run" },
  }));
}

export function recentRunEntries(runs: SurfaceRead<WorkflowRunsListResult>): ContinuityEntry[] {
  if (!runs.ok) return [unavailable("workflow runs", runs.message)];
  return runs.value.runs.slice(0, 3).map((run) => ({
    id: `recent-run-${run.id}`,
    name: safeText(run.workflow, 72),
    state: run.status,
    detail: `${run.startedAt}; run ${shortId(run.id, 24)}`,
    role: run.status === "failed" ? "error" : run.status === "success" ? "success" : "warn",
    route: { method: "GET", path: `/workflow/runs/${encodeURIComponent(run.id)}`, label: "Open run" },
  }));
}

export function reviewArtifactEntries(runs: SurfaceRead<WorkflowRunsListResult>): ContinuityEntry[] {
  if (!runs.ok) return [];
  return runs.value.runs.slice(0, 4).map((run, index) => ({
    id: `review-artifact-${index}`,
    name: safeText(`${run.workflow} artifacts`, 72),
    state: run.status,
    detail: `run ${shortId(run.id, 28)}; ${run.startedAt}`,
    role: run.status === "failed" ? "error" : "info",
    route: {
      method: "GET" as const,
      path: `/api/workflow/runs/${encodeURIComponent(run.id)}/artifacts`,
      label: "Open artifacts",
    },
  }));
}

export function approvalEntries(approvals: SurfaceRead<{ approvals: PendingApproval[] }>): ContinuityEntry[] {
  if (!approvals.ok) return [unavailable("approvals", approvals.message)];
  return approvals.value.approvals.slice(0, 5).map((approval) => ({
    id: `approval-${approval.id}`,
    name: safeText(`Approval: ${approval.tool}`, 72),
    state: approval.status,
    detail: safeText(approval.reason),
    role: approval.risk === "dangerous" ? "error" : "warn",
    route: { method: "GET" as const, path: "/approvals?status=pending", label: "Open approvals" },
  }));
}

export function ownerQuestionEntries(questions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>): ContinuityEntry[] {
  if (!questions.ok) return [unavailable("owner questions", questions.message)];
  return questions.value.questions.slice(0, 5).map((question) => ({
    id: `owner-question-${question.id}`,
    name: safeText("Owner question", 72),
    state: question.status,
    detail: safeText(question.question),
    role: "warn" as const,
    route: { method: "GET" as const, path: "/owner-questions?status=pending", label: "Open owner questions" },
  }));
}

export function ownerDecisionEntries(decisions: SurfaceRead<OwnerDecisionListResult>): ContinuityEntry[] {
  if (!decisions.ok) return [unavailable("owner decisions", decisions.message)];
  return decisions.value.decisions.slice(0, 5).map((decision) => ({
    id: `owner-decision-${decision.id}`,
    name: safeText("Owner decision", 72),
    state: decision.status,
    detail: safeText(decision.request.prompt),
    role: "warn" as const,
    route: { method: "GET" as const, path: "/owner-decisions?status=pending", label: "Open owner decisions" },
  }));
}

export function setupEntries(setup: SurfaceRead<ModuleSetupStatusResponse>): ContinuityEntry[] {
  if (!setup.ok) return [unavailable("setup", setup.message)];
  return setup.value.requirements
    .filter((requirement) => requirement.state !== "ready")
    .slice(0, 5)
    .map((requirement) => ({
      id: `setup-${requirement.moduleName}-${requirement.requirementId}`,
      name: safeText(`Setup: ${requirement.moduleName}/${requirement.requirementId}`, 72),
      state: requirement.state,
      detail: safeText(requirement.message),
      role: requirement.required ? "warn" as const : "muted" as const,
      route: { method: "GET" as const, path: "/setup/requirements", label: "Open setup" },
    }));
}

export function memoryKnowledgeEntries(args: {
  memory: SurfaceRead<MemoryListResult>;
  knowledge: SurfaceRead<KnowledgeListResult>;
}): ContinuityEntry[] {
  const entries: ContinuityEntry[] = [];
  if (args.memory.ok) {
    entries.push(...args.memory.value.entries.slice(0, 3).map((entry) => ({
      id: `memory-${entry.id}`,
      name: safeText(`Memory ${shortId(entry.id, 12)}`, 72),
      state: entry.updated ?? entry.created,
      detail: safeText(entry.content),
      role: "info" as const,
      route: { method: "GET" as const, path: "/api/memory?limit=10", label: "Open memory" },
    })));
  } else {
    entries.push(unavailable("memory", args.memory.message));
  }
  if (args.knowledge.ok) {
    entries.push(...args.knowledge.value.entries.slice(0, 3).map((entry) => ({
      id: `knowledge-${entry.id}`,
      name: safeText(`Knowledge ${shortId(entry.id, 12)}`, 72),
      state: entry.status ?? entry.type ?? "stored",
      detail: safeText(entry.title),
      role: "info" as const,
      route: { method: "GET" as const, path: "/api/knowledge", label: "Open knowledge" },
    })));
  } else {
    entries.push(unavailable("knowledge", args.knowledge.message));
  }
  return entries.slice(0, 6);
}

function triggerSummary(trigger: WorkflowDefinitionsResult["definitions"][number]["triggers"][number]): string {
  switch (trigger.type) {
    case "cron":
      return trigger.schedule;
    case "interval":
      return `${trigger.intervalMs}ms`;
    case "watch":
      return trigger.patterns.join(",");
    case "event":
      return trigger.event;
    case "webhook":
      return "webhook";
  }
}

export function recurringEntries(definitions: SurfaceRead<WorkflowDefinitionsResult>): ContinuityEntry[] {
  if (!definitions.ok) return [unavailable("workflow definitions", definitions.message)];
  return definitions.value.definitions
    .flatMap((definition) => definition.triggers.map((trigger) => ({ definition, trigger })))
    .filter(({ trigger }) => trigger.type === "cron" || trigger.type === "interval" || trigger.type === "event")
    .slice(0, 5)
    .map(({ definition, trigger }) => ({
      id: `recurring-${definition.name}-${trigger.type}`,
      name: safeText(definition.name, 72),
      state: trigger.type,
      detail: safeText(triggerSummary(trigger)),
      role: definition.enabled && definition.runtimeEnabled !== false ? "success" as const : "muted" as const,
      route: { method: "GET" as const, path: "/workflow/definitions", label: "Open workflow definitions" },
    }));
}
