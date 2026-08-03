import type { WorkflowRunDetail } from "#core/daemon/daemon-control.js";
import type { UiActionExecutionResult } from "./operator-ui-actions.js";
import {
  type CapabilityActionArgs,
  missingParameter,
  stringParameter,
} from "./operator-ui-capability-action-parameters.js";

export async function executeWorkCapabilityUiAction(
  args: CapabilityActionArgs,
): Promise<UiActionExecutionResult | null> {
  const { client, operation, parameters } = args;

  if (operation.namespace === "approvals" && operation.method === "resolve") {
    const approvalId = stringParameter(parameters, "approvalId");
    const decision = stringParameter(parameters, "decision");
    const reviewDigest = stringParameter(parameters, "reviewDigest");
    const note = stringParameter(parameters, "note");
    if (!approvalId) return missingParameter("approvalId");
    if (decision !== "approve" && decision !== "reject") {
      return { ok: false, reason: "invalid-input", message: "decision must be approve or reject." };
    }
    if (decision === "approve") {
      if (!reviewDigest) return missingParameter("reviewDigest");
      const result = await client.approvals.approve(approvalId, reviewDigest, note);
      if (!result.ok) {
        return { ok: false, reason: result.reason, message: `Approval ${approvalId} could not be approved: ${result.reason}.` };
      }
      return {
        ok: true,
        message: result.resolution.kind === "workflow_gate_approved"
          ? `Approved workflow gate ${approvalId}.`
          : `Approved ${approvalId}; tool execution ${result.resolution.execution.status}.`,
      };
    }
    const result = await client.approvals.reject(approvalId, note);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: `Approval ${approvalId} could not be rejected: ${result.reason}.` };
    }
    return { ok: true, message: `Rejected approval ${approvalId}.` };
  }

  if (operation.namespace === "ownerQuestions" && operation.method === "resolve") {
    const questionId = stringParameter(parameters, "questionId");
    const decision = stringParameter(parameters, "decision");
    const answer = stringParameter(parameters, "answer");
    const reason = stringParameter(parameters, "reason");
    if (!questionId) return missingParameter("questionId");
    if (decision === "answer") {
      if (!answer?.trim()) return missingParameter("answer");
      const result = await client.ownerQuestions.answer(questionId, answer);
      if (!result.ok) {
        return { ok: false, reason: result.reason, message: `Owner question ${questionId} was not found.` };
      }
      return { ok: true, message: `Answered owner question ${questionId}.` };
    }
    if (decision === "dismiss") {
      const result = await client.ownerQuestions.dismiss(questionId, reason);
      if (!result.ok) {
        return { ok: false, reason: result.reason, message: `Owner question ${questionId} was not found.` };
      }
      return { ok: true, message: `Dismissed owner question ${questionId}.` };
    }
    return { ok: false, reason: "invalid-input", message: "decision must be answer or dismiss." };
  }

  if (operation.namespace === "tasks" && operation.method === "list") {
    const result = await client.tasks.list(["doing", "ready", "blocked", "backlog"]);
    return { ok: true, message: `${result.tasks.length} open task(s).` };
  }
  if (operation.namespace === "tasks" && operation.method === "show") {
    const taskId = stringParameter(parameters, "taskId");
    if (!taskId) return missingParameter("taskId");
    const result = await client.tasks.show(taskId);
    if (!result.found) return { ok: false, reason: "not_found", message: `Task ${taskId} was not found.` };
    return { ok: true, message: result.content };
  }
  if (operation.namespace === "tasks" && operation.method === "move") {
    const taskId = stringParameter(parameters, "taskId");
    const state = stringParameter(parameters, "state");
    if (!taskId) return missingParameter("taskId");
    if (!state || !isRepoTaskState(state)) {
      return { ok: false, reason: "invalid-input", message: "state must be a valid task state." };
    }
    const result = await client.tasks.move(taskId, state);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: `Task ${taskId} was not moved: ${result.reason}.` };
    }
    return { ok: true, message: `Moved ${taskId} from ${result.fromState} to ${result.toState}.` };
  }
  if (operation.namespace === "tasks" && operation.method === "updateBody") {
    const taskId = stringParameter(parameters, "taskId");
    const body = stringParameter(parameters, "body");
    if (!taskId) return missingParameter("taskId");
    if (body === undefined) return missingParameter("body");
    if (!client.tasks.updateBody) {
      return { ok: false, reason: "unsupported-operation", message: "Task body editing is unavailable." };
    }
    const result = await client.tasks.updateBody(taskId, body);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: `Task ${taskId} was not updated: ${result.reason}.` };
    }
    return { ok: true, message: `Updated ${taskId}.` };
  }
  if (operation.namespace === "tasks" && operation.method === "create") {
    const title = stringParameter(parameters, "title");
    const summary = stringParameter(parameters, "summary");
    const priority = stringParameter(parameters, "priority");
    const area = stringParameter(parameters, "area");
    const state = stringParameter(parameters, "state");
    if (!title) return missingParameter("title");
    if (priority !== "p0" && priority !== "p1" && priority !== "p2" && priority !== "p3") {
      return { ok: false, reason: "invalid-input", message: "priority must be p0, p1, p2, or p3." };
    }
    if (!area) return missingParameter("area");
    if (!state || !isRepoTaskState(state)) {
      return { ok: false, reason: "invalid-input", message: "state must be a valid task state." };
    }
    const result = await client.tasks.create({ title, summary, priority, area, state });
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: result.message ?? `Task was not created: ${result.reason}.` };
    }
    return { ok: true, message: `Created ${result.id}.` };
  }

  if (operation.namespace === "sessions" && operation.method === "setAutonomyMode") {
    const sessionId = stringParameter(parameters, "sessionId");
    const autonomyMode = stringParameter(parameters, "autonomyMode");
    if (!sessionId) return missingParameter("sessionId");
    if (autonomyMode !== "passive" && autonomyMode !== "supervised" && autonomyMode !== "autonomous") {
      return { ok: false, reason: "invalid-input", message: "autonomyMode must be passive, supervised, or autonomous." };
    }
    const result = await client.sessions.setAutonomyMode(sessionId, autonomyMode);
    if (!result.ok) {
      return { ok: false, reason: result.reason, message: `Session ${sessionId} was not updated: ${result.reason}.` };
    }
    return { ok: true, message: `Session ${sessionId} now uses ${result.autonomyMode} autonomy${result.serveOwned ? " (serve-owned session metadata updated)" : ""}.` };
  }

  if (operation.namespace === "workflow" && operation.method === "getRun") {
    const runId = stringParameter(parameters, "runId");
    if (!runId) return missingParameter("runId");
    const result = await client.workflow.getRun(runId);
    if (!result.found) return { ok: false, reason: "not_found", message: `Run ${runId} was not found.` };
    return { ok: true, message: runDetail(result.run) };
  }
  if (operation.namespace === "workflow" && operation.method === "compareRuns") {
    const runIdA = stringParameter(parameters, "runIdA");
    const runIdB = stringParameter(parameters, "runIdB");
    if (!runIdA) return missingParameter("runIdA");
    if (!runIdB) return missingParameter("runIdB");
    const [left, right] = await Promise.all([
      client.workflow.getRun(runIdA),
      client.workflow.getRun(runIdB),
    ]);
    if (!left.found || !right.found) {
      const missing = !left.found ? runIdA : runIdB;
      return { ok: false, reason: "not_found", message: `Run ${missing} was not found.` };
    }
    return { ok: true, message: runComparison(left.run, right.run) };
  }

  return null;
}

function isRepoTaskState(
  value: string,
): value is "backlog" | "ready" | "doing" | "blocked" | "done" | "dropped" {
  return value === "backlog" || value === "ready" || value === "doing"
    || value === "blocked" || value === "done" || value === "dropped";
}

function runDetail(run: WorkflowRunDetail): string {
  const steps = run.steps.map((step) =>
    `${step.id} · ${step.type} · ${step.status} · ${step.durationMs}ms${step.costUsd === undefined ? "" : ` · $${step.costUsd.toFixed(4)}`}${step.error ? ` · ${step.error}` : ""}`,
  );
  return [
    `${run.id} · ${run.workflow} · ${run.status}`,
    `Started ${run.startedAt}${run.completedAt ? ` · completed ${run.completedAt}` : ""}`,
    `Duration ${run.durationMs ?? 0}ms · cost ${run.totalCostUsd === undefined ? "—" : `$${run.totalCostUsd.toFixed(4)}`}`,
    ...steps,
  ].join("\n");
}

function runComparison(left: WorkflowRunDetail, right: WorkflowRunDetail): string {
  const durationA = left.durationMs ?? 0;
  const durationB = right.durationMs ?? 0;
  const costA = left.totalCostUsd ?? 0;
  const costB = right.totalCostUsd ?? 0;
  return [
    `${left.id} ↔ ${right.id}`,
    `Workflow: ${left.workflow} ↔ ${right.workflow}`,
    `Status: ${left.status} ↔ ${right.status}`,
    `Duration: ${durationA}ms ↔ ${durationB}ms (Δ ${durationB - durationA}ms)`,
    `Cost: $${costA.toFixed(4)} ↔ $${costB.toFixed(4)} (Δ $${(costB - costA).toFixed(4)})`,
    `Steps: ${left.steps.length} ↔ ${right.steps.length}`,
  ].join("\n");
}
