/**
 * Email formatting — converts bus event payloads into email subject + text body.
 */

export type EmailMessage = {
  subject: string;
  text: string;
};

export function formatEmail(event: string, payload: Record<string, unknown>): EmailMessage {
  switch (event) {
    case "workflow.failure.alert": {
      const workflow = payload.workflow as string | undefined;
      const runId = payload.runId as string | undefined;
      const status = payload.status as string | undefined;
      const errorSummary = payload.errorSummary as string | undefined;
      const subject = `[KOTA] Workflow ${status ?? "failed"}: ${workflow ?? "unknown"}`;
      const lines = [`Workflow: ${workflow ?? "unknown"}`, `Status: ${status ?? "failed"}`];
      if (runId) lines.push(`Run: ${runId}`);
      if (errorSummary) lines.push(`\nError:\n${errorSummary}`);
      return { subject, text: lines.join("\n") };
    }

    case "workflow.attention.digest": {
      const text = payload.text as string | undefined;
      return {
        subject: "[KOTA] Attention Digest",
        text: text ?? "Attention digest — review pending items.",
      };
    }

    case "workflow.approval.expired": {
      const workflowName = payload.workflowName as string | undefined;
      const runId = payload.runId as string | undefined;
      const stepId = payload.stepId as string | undefined;
      const resolution = payload.resolution as string | undefined;
      const reason = payload.reason as string | undefined;
      const text = payload.text as string | undefined;
      const resolutionLabel = resolution === "approve" ? "Auto-Approved" : "Auto-Denied";
      const subject = `[KOTA] Approval ${resolutionLabel}: ${workflowName ?? "unknown"}`;
      const lines = [text ?? `Approval ${resolutionLabel.toLowerCase()} for ${workflowName ?? "unknown"}.`];
      if (stepId) lines.push(`Step: ${stepId}`);
      if (runId) lines.push(`Run: ${runId}`);
      if (reason) lines.push(`Reason: ${reason}`);
      return { subject, text: lines.join("\n") };
    }

    case "module.crash.alert": {
      const moduleName = payload.name as string | undefined;
      const restartCount = payload.restartCount as number | undefined;
      const windowMs = payload.windowMs as number | undefined;
      const subject = `[KOTA] Module Crash: ${moduleName ?? "unknown"}`;
      const lines = [`Module crashed repeatedly: ${moduleName ?? "unknown"}`];
      const text = payload.text as string | undefined;
      if (restartCount !== undefined) lines.push(`Restarts: ${restartCount}`);
      if (windowMs !== undefined) lines.push(`Window: ${Math.round(windowMs / 60_000)}m`);
      if (text) lines.push(`\n${text}`);
      return { subject, text: lines.join("\n") };
    }

    case "approval.requested": {
      const id = payload.id as string | undefined;
      const tool = payload.tool as string | undefined;
      const risk = payload.risk as string | undefined;
      const reason = payload.reason as string | undefined;
      const subject = `[KOTA] Approval Required: ${tool ?? "unknown"}`;
      const lines = [`Approval required for tool: ${tool ?? "unknown"}`];
      if (risk) lines.push(`Risk: ${risk}`);
      if (reason) lines.push(`Reason: ${reason}`);
      if (id) {
        lines.push("", `To approve:  kota approval approve ${id}`);
        lines.push(`To reject:   kota approval reject ${id}`);
      }
      return { subject, text: lines.join("\n") };
    }

    case "owner.question.asked": {
      const id = payload.id as string | undefined;
      const question = payload.question as string | undefined;
      const reason = payload.reason as string | undefined;
      const source = payload.source as string | undefined;
      const subject = `[KOTA] Owner Question: ${source ?? "agent"}`;
      const lines = [`Owner question from: ${source ?? "agent"}`];
      if (question) lines.push(`Question: ${question}`);
      if (reason) lines.push(`Reason: ${reason}`);
      if (id) {
        lines.push("", `To answer:   kota owner-question answer ${id} <your answer>`);
        lines.push(`To dismiss:  kota owner-question dismiss ${id}`);
      }
      return { subject, text: lines.join("\n") };
    }

    case "workflow.build.committed": {
      const commitMessage = payload.commitMessage as string | undefined;
      const taskId = payload.taskId as string | null | undefined;
      const costUsd = payload.costUsd as number | null | undefined;
      const durationMs = payload.durationMs as number | null | undefined;
      const subject = `[KOTA] Builder committed: ${commitMessage ?? ""}`;
      const meta = [
        taskId ? `Task: ${taskId}` : null,
        costUsd != null ? `Cost: $${costUsd.toFixed(2)}` : null,
        durationMs != null ? `Duration: ${Math.round(durationMs / 60000)}m` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return {
        subject,
        text: [commitMessage ?? "", meta].filter(Boolean).join("\n"),
      };
    }

    default:
      return {
        subject: `[KOTA] ${event}`,
        text: JSON.stringify(payload, null, 2),
      };
  }
}
