import { TestProjectProvider } from "@/lib/project-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";

const noop = () => {};

function renderSidebar() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TestProjectProvider projectId="test">
        <Sidebar
          collapsed={false}
          onToggle={noop}
          activeSessionId={null}
          onSessionSelect={noop}
          onHistorySelect={noop}
          onRunSelect={noop}
          onCompareRuns={noop}
          onNewChat={noop}
          connectionStatus="connected"
          darkMode={false}
          onToggleTheme={noop}
        />
      </TestProjectProvider>
    </QueryClientProvider>,
  );
}

function makeResponse(body: unknown): Response {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  } as Response;
}

async function writeWebEvidenceReport(
  nav: HTMLElement,
  primaryLabels: string[],
) {
  const runDir = process.env.KOTA_RUN_DIR;
  if (!runDir) return;

  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(runDir, { recursive: true });
  const report = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>KOTA Web Status/Inbox evidence</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 24px; color: #111827; }
      h1 { font-size: 20px; margin: 0 0 12px; }
      h2 { font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.06em; color: #4b5563; }
      code { background: #f3f4f6; padding: 2px 4px; border-radius: 4px; }
      .shell { border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; max-width: 420px; }
      button { display: flex; width: 100%; align-items: center; gap: 8px; border: 0; background: #fff; padding: 10px 0; font: inherit; font-weight: 650; text-align: left; }
      [data-intent] { border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; margin-bottom: 8px; }
      .text-muted-foreground { color: #6b7280; }
      .font-medium, .font-semibold { font-weight: 650; }
      .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    </style>
  </head>
  <body>
    <h1>KOTA Web operator intent navigation</h1>
    <p>Primary surfaces: <code>${primaryLabels.join(" / ")}</code></p>
    <p>Status and Inbox are expanded first. Inbox includes approvals, owner questions, blocked work, and attention.</p>
    <h2>Rendered navigation HTML</h2>
    <div class="shell">
      ${nav.outerHTML}
    </div>
  </body>
</html>
`;
  await writeFile(`${runDir}/web-status-inbox.html`, report, "utf8");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Sidebar operator intent navigation", () => {
  it("shows only the five operator intents as primary navigation", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const path = url.split("?")[0];
      switch (path) {
        case "/api/daemon/status":
          return makeResponse({
            daemon: {
              running: true,
              startedAt: "2026-06-18T18:47:15.290Z",
              workflow: {
                activeRuns: [],
                pendingRuns: [],
                queueLength: 0,
                completedRuns: 0,
                paused: false,
                dispatchWindowBlocked: false,
                agentConcurrency: 1,
                codeConcurrency: 1,
                workflows: {},
              },
              sessions: [],
            },
          });
        case "/api/workflow/runs":
          return makeResponse({ runs: [] });
        case "/api/modules":
          return makeResponse({ modules: [] });
        case "/api/approvals":
          return makeResponse({
            approvals: [
              {
                id: "approval-rendered-evidence",
                runId: "run-builder",
                workflow: "builder",
                stepId: "build",
                tool: "git add",
                input: {},
                requestedAt: "2026-06-18T18:47:15.290Z",
                status: "pending",
              },
            ],
          });
        case "/api/owner-questions":
          return makeResponse({
            questions: [
              {
                id: "question-copy",
                seq: 1,
                context: "client release",
                question: "Confirm owner-facing copy before release",
                reason: "Operator-visible wording changed",
                source: "builder",
                createdAt: "2026-06-18T18:47:15.290Z",
                status: "pending",
                proposedAnswers: ["Proceed"],
              },
            ],
          });
        case "/api/tasks":
          return makeResponse({
            counts: { inbox: 0, ready: 0, backlog: 0, doing: 0, blocked: 1 },
            tasks: {
              doing: [],
              ready: [],
              backlog: [],
              blocked: [
                {
                  id: "task-operator-capture",
                  title: "Capture operator evidence",
                  priority: "p1",
                  area: "client",
                  summary: "Waiting on operator capture",
                  body: "",
                },
              ],
            },
          });
        case "/api/attention":
          return makeResponse({ data: { items: [] }, text: "" });
        default:
          return makeResponse({});
      }
    }) as unknown as typeof fetch;

    renderSidebar();

    const nav = screen.getByRole("navigation", { name: "Primary navigation" });
    const primary = within(nav).getAllByRole("button", {
      name: /^(Status|Inbox|Work|Knowledge|Setup)$/,
    });
    const primaryLabels = primary.map(
      (button) => button.textContent?.trim() ?? "",
    );
    expect(primaryLabels).toEqual([
      "Status",
      "Inbox",
      "Work",
      "Knowledge",
      "Setup",
    ]);

    expect(
      within(nav).queryByRole("button", { name: "Overview" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Capture operator evidence"),
    ).toBeInTheDocument();
    expect(await screen.findByText("git add")).toBeInTheDocument();
    expect(
      await screen.findByText("Confirm owner-facing copy before release"),
    ).toBeInTheDocument();
    await writeWebEvidenceReport(nav, primaryLabels);
  });
});
