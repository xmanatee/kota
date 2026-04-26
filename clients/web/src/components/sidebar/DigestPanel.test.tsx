/**
 * DigestPanel test — exercises the panel through the same /api/digest surface
 * the daemon route exposes, asserting:
 *
 *  - active payload renders the rendered text body and an "active" label
 *  - quiet payload (`data.quiet === true`) renders a distinct "quiet window" label
 *  - failed /api/digest surfaces the daemon's error one-to-one
 */

import type { DigestResponse } from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DigestPanel } from "./DigestPanel";

function makeWrapper(): {
  Wrapper: ({ children }: { children: ReactNode }) => ReactElement;
  client: QueryClient;
} {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { Wrapper, client };
}

const ACTIVE_PAYLOAD: DigestResponse = {
  data: {
    windowStartedAt: "2026-04-25T08:00:00.000Z",
    windowEndedAt: "2026-04-26T08:00:00.000Z",
    builderCommits: [
      {
        runId: "r-1",
        taskId: "task-foo",
        taskTitle: "Add foo",
        commitSubject: "Add foo",
        durationMs: 60000,
      },
    ],
    explorerAdditions: [],
    decomposerSplits: [],
    blockedPromoterMoves: [],
    failedMonitoredRuns: [],
    pendingOwnerQuestions: [],
    agingOperatorCaptures: [],
    queueDelta: {
      current: { backlog: 0, ready: 1, doing: 0, blocked: 8 },
      previous: null,
      delta: { backlog: null, ready: null, doing: null, blocked: null },
    },
    quiet: false,
  },
  text: "Daily digest 2026-04-26\n- builder committed: Add foo",
};

const QUIET_PAYLOAD: DigestResponse = {
  data: {
    windowStartedAt: "2026-04-25T08:00:00.000Z",
    windowEndedAt: "2026-04-26T08:00:00.000Z",
    builderCommits: [],
    explorerAdditions: [],
    decomposerSplits: [],
    blockedPromoterMoves: [],
    failedMonitoredRuns: [],
    pendingOwnerQuestions: [],
    agingOperatorCaptures: [],
    queueDelta: {
      current: { backlog: 0, ready: 0, doing: 0, blocked: 0 },
      previous: null,
      delta: { backlog: null, ready: null, doing: null, blocked: null },
    },
    quiet: true,
  },
  text: "Daily digest 2026-04-26\n(quiet window — nothing to report)",
};

describe("DigestPanel", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
    localStorage.setItem("kota-auth-token", "test-token");
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    vi.resetModules();
  });

  it("renders the rendered body and an active label for an active payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ACTIVE_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <DigestPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/builder committed: Add foo/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.queryByText("quiet window")).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/digest",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("labels quiet windows distinctly using data.quiet", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(QUIET_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <DigestPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("quiet window")).toBeInTheDocument(),
    );
    expect(screen.queryByText("active")).not.toBeInTheDocument();
    expect(
      screen.getByText(/quiet window — nothing to report/),
    ).toBeInTheDocument();
  });

  it("surfaces the daemon's typed error when /api/digest fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve("digest unavailable"),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <DigestPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText(/digest unavailable/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/API error 503/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
