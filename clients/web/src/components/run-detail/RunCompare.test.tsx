import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { WorkflowRunDetail, WorkflowRunSummary } from "@/api/types";
/**
 * RunCompare test — covers the operator workflow of selecting two runs of
 * the same workflow and seeing the diff render correctly:
 *
 *  - Marking two same-workflow runs and clicking Compare hands the right
 *    pair of ids to the host (which then routes to RunCompare).
 *  - Marking two different-workflow runs blocks the Compare action with
 *    a same-workflow notice.
 *  - The compare view itself renders status, duration, and cost deltas
 *    plus the outcome change row using fixture-backed run details.
 *  - Single-run view (RunDetail) still works after the changes.
 */
import { RunCompare } from "@/components/run-detail/RunCompare";
import { RunDetail } from "@/components/run-detail/RunDetail";
import { WorkflowPanel } from "@/components/sidebar/WorkflowPanel";
import { TestProjectProvider } from "@/lib/project-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function emitEvidence(name: string, html: string): void {
  const target = process.env.KOTA_RUN_DIR;
  if (!target) return;
  const out = resolve(target, name);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    [
      "<!doctype html>",
      `<html lang="en"><head><meta charset="utf-8"><title>${name}</title>`,
      "<style>body{font-family:system-ui,sans-serif;padding:1rem;background:#fafafa;color:#111}",
      "table{border-collapse:collapse}th,td{padding:4px 8px;border:1px solid #ddd;text-align:left;font-size:12px}",
      ".positive{color:#16a34a}.negative{color:#ca8a04}.muted{color:#666}</style>",
      "</head><body>",
      html,
      "</body></html>",
    ].join("\n"),
  );
}

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <TestProjectProvider>{children}</TestProjectProvider>
      </QueryClientProvider>
    );
  }
  return { Wrapper };
}

const RUN_A_SUMMARY: WorkflowRunSummary = {
  id: "2026-05-01T01-00-00-000Z-builder-aaaaaa",
  workflow: "builder",
  status: "failed",
  triggerEvent: "autonomy.queue.available",
  startedAt: "2026-05-01T01:00:00.000Z",
  durationMs: 240_000,
  totalCostUsd: 0.5612,
};

const RUN_B_SUMMARY: WorkflowRunSummary = {
  id: "2026-05-02T01-00-00-000Z-builder-bbbbbb",
  workflow: "builder",
  status: "success",
  triggerEvent: "autonomy.queue.available",
  startedAt: "2026-05-02T01:00:00.000Z",
  durationMs: 180_000,
  totalCostUsd: 0.4123,
};

const RUN_C_SUMMARY: WorkflowRunSummary = {
  id: "2026-05-02T02-00-00-000Z-explorer-cccccc",
  workflow: "explorer",
  status: "success",
  triggerEvent: "autonomy.queue.empty",
  startedAt: "2026-05-02T02:00:00.000Z",
  durationMs: 60_000,
  totalCostUsd: 0.1,
};

const RUN_A_DETAIL: WorkflowRunDetail = {
  ...RUN_A_SUMMARY,
  completedAt: "2026-05-01T01:04:00.000Z",
  steps: [
    {
      id: "plan",
      type: "agent",
      status: "success",
      durationMs: 60_000,
      costUsd: 0.2,
    },
    {
      id: "build",
      type: "agent",
      status: "failed",
      durationMs: 180_000,
      costUsd: 0.3612,
      error: "missing acceptance evidence",
    },
  ],
};

const RUN_B_DETAIL: WorkflowRunDetail = {
  ...RUN_B_SUMMARY,
  completedAt: "2026-05-02T01:03:00.000Z",
  steps: [
    {
      id: "plan",
      type: "agent",
      status: "success",
      durationMs: 55_000,
      costUsd: 0.18,
    },
    {
      id: "build",
      type: "agent",
      status: "success",
      durationMs: 100_000,
      costUsd: 0.2123,
    },
    {
      id: "verify",
      type: "code",
      status: "success",
      durationMs: 25_000,
      costUsd: 0.02,
    },
  ],
};

type FetchInput = string | URL | Request;
type FetchHandler = (input: FetchInput, init?: RequestInit) => Promise<unknown>;

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function installFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: FetchInput, init?: RequestInit) => {
    const body = await handler(input, init);
    return {
      ok: true,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as Response;
  });
  globalThis.fetch = mock as unknown as typeof fetch;
  return mock;
}

function panelHandler(): FetchHandler {
  return async (input) => {
    const url = urlOf(input);
    const path = url.split("?")[0];
    if (path === "/api/workflow/status") {
      return {
        activeRuns: [],
        pendingRuns: [],
        queueLength: 0,
        completedRuns: 0,
        paused: false,
        agentConcurrency: 1,
        codeConcurrency: 4,
        workflows: { builder: { enabled: true }, explorer: { enabled: true } },
      };
    }
    if (path === "/api/workflow/definitions") return { definitions: [] };
    if (path === "/api/workflow/runs") {
      return { runs: [RUN_A_SUMMARY, RUN_B_SUMMARY, RUN_C_SUMMARY] };
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
}

function compareHandler(): FetchHandler {
  return async (input) => {
    const url = urlOf(input);
    const path = url.split("?")[0];
    if (path === `/api/workflow/runs/${encodeURIComponent(RUN_A_DETAIL.id)}`) {
      return RUN_A_DETAIL;
    }
    if (path === `/api/workflow/runs/${encodeURIComponent(RUN_B_DETAIL.id)}`) {
      return RUN_B_DETAIL;
    }
    throw new Error(`Unexpected fetch ${url}`);
  };
}

describe("WorkflowPanel — compare selection", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    localStorage.setItem("kota-auth-token", "test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.resetModules();
  });

  it("enables Compare for two same-workflow runs and hands the pair to the host", async () => {
    installFetch(panelHandler());
    const { Wrapper } = makeWrapper();
    const compareCalls: Array<[string, string]> = [];
    render(
      <Wrapper>
        <WorkflowPanel
          onRunSelect={() => undefined}
          onCompareRuns={(a, b) => compareCalls.push([a, b])}
        />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getAllByLabelText(/builder run .* for comparison/),
      ).toHaveLength(2),
    );

    const builderCheckboxes = screen.getAllByLabelText(
      /builder run .* for comparison/,
    );
    fireEvent.click(builderCheckboxes[0]!);
    fireEvent.click(builderCheckboxes[1]!);

    const compareBtn = screen.getByRole("button", { name: /^Compare$/ });
    expect(compareBtn).toBeEnabled();
    fireEvent.click(compareBtn);

    expect(compareCalls).toEqual([[RUN_A_SUMMARY.id, RUN_B_SUMMARY.id]]);
  });

  it("blocks Compare for two different-workflow runs and shows a same-workflow notice", async () => {
    installFetch(panelHandler());
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <WorkflowPanel
          onRunSelect={() => undefined}
          onCompareRuns={() => undefined}
        />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getAllByLabelText(/builder run .* for comparison/),
      ).toHaveLength(2),
    );

    fireEvent.click(
      screen.getAllByLabelText(/builder run .* for comparison/)[0]!,
    );
    fireEvent.click(screen.getByLabelText(/explorer run .* for comparison/));

    expect(screen.getByText(/same workflow only/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Compare$/ })).toBeDisabled();
  });
});

describe("RunCompare — render", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    localStorage.setItem("kota-auth-token", "test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.resetModules();
  });

  it("renders status, duration, and cost deltas for two same-workflow runs", async () => {
    installFetch(compareHandler());
    const { Wrapper } = makeWrapper();
    const { container } = render(
      <Wrapper>
        <RunCompare
          runIdA={RUN_A_DETAIL.id}
          runIdB={RUN_B_DETAIL.id}
          onClose={() => undefined}
        />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("run-compare-summary")).toBeInTheDocument(),
    );

    const outcome = screen.getByTestId("run-compare-outcome");
    expect(outcome).toHaveTextContent("failed");
    expect(outcome).toHaveTextContent("success");
    expect(outcome).toHaveTextContent(/outcome changed/);

    expect(screen.getByTestId("run-compare-duration-delta")).toHaveTextContent(
      "-1m0s",
    );
    expect(screen.getByTestId("run-compare-cost-delta")).toHaveTextContent(
      "-$0.1489",
    );

    const buildRow = screen.getByTestId("run-compare-step-row-build");
    expect(buildRow).toHaveTextContent(/failed/);
    expect(buildRow).toHaveTextContent(/success/);

    const verifyRow = screen.getByTestId("run-compare-step-row-verify");
    expect(verifyRow).toHaveTextContent("verify");
    expect(verifyRow).toHaveTextContent(/—/);

    emitEvidence("web-run-compare-rendered.html", container.innerHTML);
  });

  it("rejects runs of different workflows with an explicit message", async () => {
    installFetch(async (input) => {
      const url = urlOf(input);
      const path = url.split("?")[0];
      if (
        path === `/api/workflow/runs/${encodeURIComponent(RUN_A_DETAIL.id)}`
      ) {
        return RUN_A_DETAIL;
      }
      if (
        path === `/api/workflow/runs/${encodeURIComponent(RUN_C_SUMMARY.id)}`
      ) {
        return { ...RUN_A_DETAIL, id: RUN_C_SUMMARY.id, workflow: "explorer" };
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RunCompare
          runIdA={RUN_A_DETAIL.id}
          runIdB={RUN_C_SUMMARY.id}
          onClose={() => undefined}
        />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Cannot compare runs of different workflows/),
      ).toBeInTheDocument(),
    );
  });
});

describe("RunDetail — single-run view still works", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    localStorage.setItem("kota-auth-token", "test-token");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.resetModules();
  });

  it("renders steps for a single selected run", async () => {
    installFetch(compareHandler());
    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RunDetail runId={RUN_B_DETAIL.id} onClose={() => undefined} />
      </Wrapper>,
    );

    await waitFor(() => expect(screen.getByText("verify")).toBeInTheDocument());
    expect(screen.getByText("plan")).toBeInTheDocument();
    expect(screen.getByText("build")).toBeInTheDocument();
  });
});
