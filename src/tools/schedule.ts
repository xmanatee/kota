import type Anthropic from "@anthropic-ai/sdk";
import { getScheduler, parseRepeat, parseTime } from "../scheduler.js";
import type { ToolResult } from "./index.js";

export const scheduleTool: Anthropic.Tool = {
  name: "schedule",
  description:
    "Set reminders, schedule recurring tasks, or create event-triggered automations. " +
    "Time-based: natural expressions (\"in 30 minutes\", \"tomorrow at 9am\"). " +
    "Event-based: trigger on internal events (\"session.end\", \"action.complete\"). " +
    "Events: session.start, session.end, action.start, action.complete, schedule.fire, " +
    "or any custom event name.",
  input_schema: {
    type: "object" as const,
    properties: {
      action: {
        type: "string",
        enum: ["add", "on_event", "list", "cancel"],
        description:
          "'add' for time-based schedules, 'on_event' for event-triggered automations",
      },
      description: {
        type: "string",
        description: "What to remind about (for 'add' and 'on_event')",
      },
      time: {
        type: "string",
        description:
          'When to trigger — natural expression ("in 30 minutes", "tomorrow at 9am", "at 3pm") or ISO datetime (for \'add\')',
      },
      repeat: {
        type: "string",
        description:
          'For \'add\': repeat schedule ("every 30 minutes", "hourly", "daily"). For \'on_event\': set to "true" to re-arm after each fire.',
      },
      event: {
        type: "string",
        description:
          "Event name to trigger on (for 'on_event'). Examples: \"session.end\", \"action.complete\".",
      },
      filter: {
        type: "object",
        description:
          'Optional payload filter for event triggers (for \'on_event\'). All keys must match. Example: {"label": "build-agent"}.',
        additionalProperties: { type: "string" },
      },
      agent_action: {
        type: "string",
        description:
          "Optional agent prompt to execute autonomously when triggered. " +
          'Example: "Check the weather in NYC and save a summary to /tmp/weather.txt". ' +
          "Without this, the schedule only sends a notification. With it, KOTA executes the prompt as a background task.",
      },
      id: {
        type: "number",
        description: "Schedule ID (for 'cancel')",
      },
    },
    required: ["action"],
  },
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const today = now.toDateString();
  const tomorrow = new Date(now.getTime() + 86_400_000).toDateString();
  const timeStr = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (d.toDateString() === today) return `today at ${timeStr}`;
  if (d.toDateString() === tomorrow) return `tomorrow at ${timeStr}`;
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} at ${timeStr}`;
}

export async function runSchedule(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const action = input.action as string;
  const scheduler = getScheduler();

  switch (action) {
    case "add": {
      const description = input.description as string;
      if (!description)
        return { content: "Error: description is required", is_error: true };
      const timeExpr = input.time as string;
      if (!timeExpr)
        return { content: "Error: time is required", is_error: true };

      const triggerAt = parseTime(timeExpr);
      if (!triggerAt)
        return {
          content: `Error: could not parse time "${timeExpr}". Try "in 30 minutes", "tomorrow at 9am", "at 3pm", or ISO datetime.`,
          is_error: true,
        };

      let repeatOpts: { repeatMs: number; repeatLabel: string } | undefined;
      if (input.repeat) {
        const parsed = parseRepeat(input.repeat as string);
        if (!parsed)
          return {
            content: `Error: could not parse repeat "${input.repeat}". Try "every 30 minutes", "hourly", or "daily".`,
            is_error: true,
          };
        repeatOpts = { repeatMs: parsed.ms, repeatLabel: parsed.label };
      }

      const agentAction = input.agent_action as string | undefined;

      const item = scheduler.add(description, triggerAt, {
        ...repeatOpts,
        action: agentAction,
      });
      const timeLabel = formatTime(item.triggerAt);
      const repeatLabel = item.repeatLabel ? ` (${item.repeatLabel})` : "";
      const actionLabel = item.action ? " [autonomous]" : "";
      return {
        content: `Scheduled #${item.id}: "${description}" — ${timeLabel}${repeatLabel}${actionLabel}`,
      };
    }

    case "on_event": {
      const description = input.description as string;
      if (!description)
        return { content: "Error: description is required", is_error: true };
      const eventName = input.event as string;
      if (!eventName)
        return { content: "Error: event is required for on_event", is_error: true };

      const repeatFlag =
        input.repeat === "true" || input.repeat === true;
      const filter = input.filter as Record<string, string> | undefined;
      const agentAction = input.agent_action as string | undefined;

      const item = scheduler.addEventTrigger(description, eventName, {
        filter,
        repeat: repeatFlag,
        action: agentAction,
      });
      const filterLabel = item.triggerFilter
        ? ` {${Object.entries(item.triggerFilter).map(([k, v]) => `${k}=${v}`).join(", ")}}`
        : "";
      const repeatLabel = item.repeat ? " (repeat)" : " (once)";
      const actionLabel = item.action ? " [autonomous]" : "";
      return {
        content: `Event trigger #${item.id}: "${description}" — on ${eventName}${filterLabel}${repeatLabel}${actionLabel}`,
      };
    }

    case "list": {
      const items = scheduler.pending();
      if (items.length === 0) return { content: "No scheduled items." };
      const now = new Date();
      const lines = items.map((item) => {
        if (item.triggerEvent) {
          const filterLabel = item.triggerFilter
            ? ` {${Object.entries(item.triggerFilter).map(([k, v]) => `${k}=${v}`).join(", ")}}`
            : "";
          const repeatLabel = item.repeat ? " (repeat)" : " (once)";
          const auto = item.action ? " [autonomous]" : "";
          return `#${item.id}: "${item.description}" — on ${item.triggerEvent}${filterLabel}${repeatLabel}${auto}`;
        }
        const due = new Date(item.triggerAt) <= now ? " [OVERDUE]" : "";
        const repeat = item.repeatLabel ? ` (${item.repeatLabel})` : "";
        const auto = item.action ? " [autonomous]" : "";
        return `#${item.id}: "${item.description}" — ${formatTime(item.triggerAt)}${repeat}${due}${auto}`;
      });
      return { content: `${items.length} scheduled:\n${lines.join("\n")}` };
    }

    case "cancel": {
      const id = input.id as number;
      if (id === undefined)
        return { content: "Error: id is required", is_error: true };
      const cancelled = scheduler.cancel(id);
      return cancelled
        ? { content: `Cancelled schedule #${id}` }
        : { content: `Schedule #${id} not found or already fired`, is_error: true };
    }

    default:
      return { content: `Error: unknown action '${action}'`, is_error: true };
  }
}
