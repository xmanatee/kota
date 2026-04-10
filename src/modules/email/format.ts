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

    case "workflow.budget.exceeded": {
      const dailySpend = payload.dailySpend as number | undefined;
      const budget = payload.budget as number | undefined;
      const subject = "[KOTA] Budget Exceeded";
      const lines = ["Daily budget exceeded."];
      if (budget !== undefined) lines.push(`Budget: $${budget.toFixed(2)}`);
      if (dailySpend !== undefined) lines.push(`Daily spend: $${dailySpend.toFixed(2)}`);
      return { subject, text: lines.join("\n") };
    }

    case "workflow.budget.warning": {
      const dailySpend = payload.dailySpend as number | undefined;
      const budget = payload.budget as number | undefined;
      const subject = "[KOTA] Budget Warning";
      const lines = ["Approaching daily budget limit."];
      if (budget !== undefined) lines.push(`Budget: $${budget.toFixed(2)}`);
      if (dailySpend !== undefined) lines.push(`Daily spend: $${dailySpend.toFixed(2)}`);
      return { subject, text: lines.join("\n") };
    }

    case "workflow.attention.digest": {
      const text = payload.text as string | undefined;
      return {
        subject: "[KOTA] Attention Digest",
        text: text ?? "Attention digest — review pending items.",
      };
    }

    case "workflow.cost.limit.reached": {
      const limitUsd = payload.limitUsd as number | undefined;
      const subject = "[KOTA] Cost Limit Reached";
      const lines = ["Workflow cost limit reached."];
      if (limitUsd !== undefined) lines.push(`Limit: $${limitUsd.toFixed(2)}`);
      return { subject, text: lines.join("\n") };
    }

    case "workflow.cost.anomaly": {
      const workflow = payload.workflow as string | undefined;
      const costUsd = payload.costUsd as number | undefined;
      const subject = `[KOTA] Cost Anomaly: ${workflow ?? "unknown"}`;
      const lines = [`Cost anomaly detected for workflow: ${workflow ?? "unknown"}`];
      if (costUsd !== undefined) lines.push(`Cost: $${costUsd.toFixed(2)}`);
      return { subject, text: lines.join("\n") };
    }

    case "workflow.approval.expired": {
      const id = payload.id as string | undefined;
      const tool = payload.tool as string | undefined;
      const subject = "[KOTA] Approval Expired";
      const lines = ["A pending approval has expired."];
      if (tool) lines.push(`Tool: ${tool}`);
      if (id) lines.push(`ID: ${id}`);
      return { subject, text: lines.join("\n") };
    }

    case "module.crash.alert": {
      const moduleName = payload.module as string | undefined;
      const subject = `[KOTA] Module Crash: ${moduleName ?? "unknown"}`;
      const lines = [`Module crashed repeatedly: ${moduleName ?? "unknown"}`];
      const text = payload.text as string | undefined;
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
