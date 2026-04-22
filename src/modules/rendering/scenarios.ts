/**
 * Representative rendering scenarios used as module evidence. Each
 * scenario is a named RenderNode that exercises one visible surface
 * (status banner, session turn, tool invocation, run summary) plus the
 * common primitive mix. The render-tree-to-string path makes the
 * output machine-inspectable so the scenarios double as snapshot
 * fixtures and as peer-CLI comparison inputs.
 */

import {
  agentMessage,
  blank,
  heading,
  kvBlock,
  line,
  list,
  panel,
  plain,
  type RenderNode,
  span,
  stack,
  statusBanner,
  toolCall,
} from "./primitives.js";

export type Scenario = {
  name: string;
  description: string;
  node: RenderNode;
};

const statusBannerScenario: Scenario = {
  name: "status-banner",
  description: "Top-level run verdict — used at the end of a workflow or session.",
  node: stack(
    statusBanner("success", "build green", "3 files changed, 12 tests passed"),
    blank(),
    statusBanner("warn", "1 follow-up task queued"),
    blank(),
    statusBanner("error", "critic rejected", "success criteria 4 and 5 unverified"),
  ),
};

const sessionTurnScenario: Scenario = {
  name: "session-turn",
  description: "One turn of an interactive coding session: user, assistant, nested tool call.",
  node: stack(
    agentMessage("user", line(plain("Find all uses of getTaskQueueSnapshot and list their callers."))),
    blank(),
    agentMessage(
      "assistant",
      stack(
        line(plain("Running a typed search across the repo.")),
        toolCall("grep", "success", {
          summary: "getTaskQueueSnapshot",
          args: "-n --glob src/**/*.ts",
          result: "12 matches in 7 files",
        }),
        blank(),
        line(plain("Top callers:")),
        list([
          { spans: [span("src/modules/autonomy/workflows/builder/workflow.ts", "accent")] },
          { spans: [span("src/modules/autonomy/workflows/dispatcher/workflow.ts", "accent")] },
          { spans: [span("src/modules/daemon-ops/dashboard.ts", "accent")] },
        ]),
      ),
    ),
  ),
};

const toolInvocationScenario: Scenario = {
  name: "tool-invocation",
  description: "Standalone tool-call display used inside autonomy workflow logs.",
  node: stack(
    toolCall("file.edit", "success", {
      summary: "src/modules/rendering/render.ts",
      args: "replace_all=false",
      result: "1 replacement",
    }),
    toolCall("shell", "warn", {
      summary: "pnpm exec vitest run",
      result: "1 test flaky — retried and passed",
    }),
    toolCall("git.commit", "error", {
      summary: "denied by agent guard",
      result: "agents must stage and write commit-message.txt",
    }),
  ),
};

const runSummaryScenario: Scenario = {
  name: "run-summary",
  description: "Workflow run summary with key metrics and a diff preview.",
  node: stack(
    heading("Run: 2026-04-22T18-18-52-873Z-builder-5ncyhs", 1),
    blank(),
    kvBlock([
      { label: "Workflow", value: "builder" },
      { label: "Status", value: "success", role: "success" },
      { label: "Trigger", value: "autonomy.queue.available" },
      { label: "Duration", value: "12m 04s" },
      { label: "Cost", value: "$0.412" },
    ]),
    blank(),
    heading("Steps", 2),
    list([
      { spans: [span("inspect-ready-queue", "success", true), plain("  ok  3ms")] },
      { spans: [span("build", "success", true), plain("  ok  11m")] },
      { spans: [span("commit", "success", true), plain("  ok  108ms")] },
    ]),
    blank(),
    panel(
      stack(
        line(span("+", "success"), plain(" src/modules/rendering/index.ts        new")),
        line(span("+", "success"), plain(" src/modules/rendering/render.ts       new")),
        line(span("+", "success"), plain(" src/modules/rendering/transport.ts    new")),
        line(span("~", "warn"), plain(" src/modules/daemon-ops/status-cli.ts  migrated")),
      ),
      { title: "Changes", role: "info" },
    ),
  ),
};

export const SCENARIOS: readonly Scenario[] = [
  statusBannerScenario,
  sessionTurnScenario,
  toolInvocationScenario,
  runSummaryScenario,
];
