import type { Command } from "commander";
import type {
  OwnerDecisionClientProjection,
  OwnerDecisionJsonObject,
  OwnerDecisionSelectedValue,
  OwnerDecisionStatus,
} from "#core/daemon/owner-decision-store.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  line,
  plain,
  prose,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";

const VALID_STATUSES: OwnerDecisionStatus[] = ["pending", "answered", "canceled", "expired", "consumed"];

type AnswerOptions = {
  single?: string;
  multi?: string;
  text?: string;
  form?: string;
};

function formatAge(createdAt: string): string {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(ageMs / 86_400_000);
  return `${days}d ago`;
}

function statusRole(status: OwnerDecisionStatus): "success" | "error" | "warn" | "muted" | "accent" {
  switch (status) {
    case "answered":
    case "consumed":
      return "success";
    case "canceled":
      return "muted";
    case "expired":
      return "warn";
    case "pending":
      return "accent";
  }
}

function selectedValueText(value: OwnerDecisionSelectedValue | undefined): string {
  if (!value) return "not answered";
  if (value.kind === "single-choice") return value.optionId;
  if (value.kind === "multi-choice") return value.optionIds.join(", ");
  if (value.kind === "free-text") return value.text;
  return JSON.stringify(value.fields);
}

function renderSummary(item: OwnerDecisionClientProjection): RenderNode {
  const action = item.action ? ` action=${item.action.actionId}` : "";
  return stack(
    line(
      span(`  [${item.id}]`, "accent", true),
      plain(` ${formatAge(item.createdAt)} status=`),
      span(item.status, statusRole(item.status)),
      plain(` kind=${item.request.kind}${action}`),
    ),
    line(span("    Prompt:   ", "muted"), plain(item.request.prompt)),
    line(span("    Detail:   ", "muted"), plain(`kota owner-decision show ${item.id}`)),
    blank(),
  );
}

function renderDetail(item: OwnerDecisionClientProjection): RenderNode {
  const rows: RenderNode[] = [
    line(
      span(`Owner decision [${item.id}]`, "accent", true),
      plain(" status="),
      span(item.status, statusRole(item.status)),
    ),
    line(span("    Scope:    ", "muted"), plain(item.scopeId)),
    line(span("    Created:  ", "muted"), plain(item.createdAt)),
    line(span("    Updated:  ", "muted"), plain(item.updatedAt)),
    line(span("    Kind:     ", "muted"), plain(item.request.kind)),
    line(span("    Prompt:   ", "muted"), plain(item.request.prompt)),
    line(span("    Selected: ", "muted"), plain(selectedValueText(item.selectedValue))),
  ];
  if (item.ownerQuestionId) rows.push(line(span("    Question: ", "muted"), plain(item.ownerQuestionId)));
  if (item.expiresAt) rows.push(line(span("    Expires:  ", "muted"), plain(item.expiresAt)));
  if (item.action) {
    rows.push(
      line(span("    Action:   ", "muted"), plain(`${item.action.actionId} via ${item.action.adapterName}`)),
      line(span("    Dry run:  ", "muted"), plain(String(item.action.dryRun))),
      line(span("    Danger:   ", "muted"), plain(String(item.action.dangerousEffect))),
    );
  }
  if (item.consumption) {
    rows.push(
      line(span("    Consumed: ", "muted"), plain(item.consumption.consumedAt)),
      line(span("    Run:      ", "muted"), plain(item.consumption.runId)),
    );
  }
  if (item.canceledReason) rows.push(line(span("    Reason:   ", "muted"), plain(item.canceledReason)));
  if (item.evidence.length > 0) {
    rows.push(line(span("    Evidence:", "muted")));
    for (const evidence of item.evidence) rows.push(prose(`- ${evidence.summary}`));
  }
  if (item.status === "pending") {
    rows.push(
      line(span("    Answer:   ", "muted"), plain(`kota owner-decision answer ${item.id} --single <option>`)),
      line(span("    Cancel:   ", "muted"), plain(`kota owner-decision cancel ${item.id} --reason <text>`)),
    );
  }
  return stack(...rows, blank());
}

function parseSelectedValue(opts: AnswerOptions): OwnerDecisionSelectedValue {
  const selected = [opts.single, opts.multi, opts.text, opts.form].filter((value) => value !== undefined);
  if (selected.length !== 1) {
    throw new Error("provide exactly one of --single, --multi, --text, or --form");
  }
  if (opts.single !== undefined) return { kind: "single-choice", optionId: opts.single };
  if (opts.multi !== undefined) {
    return {
      kind: "multi-choice",
      optionIds: opts.multi.split(",").map((id) => id.trim()).filter((id) => id.length > 0),
    };
  }
  if (opts.text !== undefined) return { kind: "free-text", text: opts.text };
  const fields = JSON.parse(opts.form ?? "{}") as OwnerDecisionJsonObject;
  return { kind: "form", fields };
}

async function loadDecisionById(
  ctx: ModuleContext,
  id: string,
): Promise<OwnerDecisionClientProjection | null> {
  const result = await ctx.client.ownerDecisions.show(id);
  return result.found ? result.decision : null;
}

export function registerOwnerDecisionCommands(program: Command, ctx: ModuleContext): void {
  const cmd = program
    .command("owner-decision")
    .description("Manage persisted owner decisions");

  cmd
    .command("list")
    .description("List owner decisions")
    .option("--status <status>", `Filter by status: ${["all", ...VALID_STATUSES].join(", ")}`)
    .action(async (opts: { status?: string }) => {
      const status = opts.status as OwnerDecisionStatus | "all" | undefined;
      if (status && status !== "all" && !VALID_STATUSES.includes(status)) {
        console.error(`Error: invalid status "${status}".`);
        process.exit(1);
      }
      const result = await ctx.client.ownerDecisions.list({ status });
      if (result.decisions.length === 0) {
        print(line(plain("No owner decisions found.")));
        return;
      }
      print(stack(
        line(span(String(result.decisions.length), "accent", true), plain(" owner decision(s):")),
        blank(),
        ...result.decisions.map(renderSummary),
      ));
    });

  cmd
    .command("show <id>")
    .description("Show a persisted owner decision")
    .action(async (id: string) => {
      const decision = await loadDecisionById(ctx, id);
      if (!decision) {
        console.error(`Error: owner decision "${id}" not found.`);
        process.exit(1);
      }
      print(renderDetail(decision));
    });

  cmd
    .command("answer <id>")
    .description("Answer a pending owner decision")
    .option("--single <optionId>", "Single-choice selected option id")
    .option("--multi <optionIds>", "Comma-separated multi-choice option ids")
    .option("--text <text>", "Free-text answer")
    .option("--form <json>", "Structured form answer JSON object")
    .action(async (id: string, opts: AnswerOptions) => {
      let selectedValue: OwnerDecisionSelectedValue;
      try {
        selectedValue = parseSelectedValue(opts);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : "invalid answer"}`);
        process.exit(1);
      }
      const result = await ctx.client.ownerDecisions.answer(id, selectedValue);
      if (!result.ok) {
        console.error(`Error: owner decision "${id}" not found or already resolved.`);
        process.exit(1);
      }
      print(line(span("Answered ", "success"), span(`[${id}]`, "accent")));
    });

  cmd
    .command("cancel <id>")
    .description("Cancel a pending owner decision")
    .option("-r, --reason <text>", "Reason for cancellation", "canceled")
    .action(async (id: string, opts: { reason: string }) => {
      const result = await ctx.client.ownerDecisions.cancel(id, opts.reason);
      if (!result.ok) {
        console.error(`Error: owner decision "${id}" not found or already resolved.`);
        process.exit(1);
      }
      print(line(span("Canceled ", "muted"), span(`[${id}]`, "accent")));
    });
}
