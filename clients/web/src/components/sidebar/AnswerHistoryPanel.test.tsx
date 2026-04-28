/**
 * AnswerHistoryPanel test — exercises the panel through the same /api/answers
 * + /api/answers/:id surfaces the daemon route exposes, asserting:
 *
 *  - Log mode renders the typed `AnswerHistoryEntry[]` projection mixing one
 *    `ok: true` row and one `ok: false` row, each with the expected
 *    truncated query and ok/reason badge.
 *  - Empty log renders the fixed "No answers in history yet." message.
 *  - Show mode renders each of the four discriminated `AnswerResult` arms
 *    (`ok: true`, `no_hits`, `semantic_unavailable`, `synthesis_failed`)
 *    with the header line for `id` + `createdAt` + `query`.
 *  - Missing-id arm (`ok: false`, `reason: "not_found"`) renders a fixed
 *    message instead of the answer view.
 *  - Click-through from a log row opens show view for that id.
 */

import type {
  AnswerHistoryListResult,
  AnswerHistoryRecord,
  AnswerHistoryShowResult,
  AnswerResult,
} from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerHistoryPanel } from "./AnswerHistoryPanel";

function makeWrapper(): {
  Wrapper: ({ children }: { children: ReactNode }) => ReactElement;
} {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return { Wrapper };
}

const OK_TRUE_ENTRY = {
  id: "2026-04-27T10-00-00-000Z-aaaaaa",
  createdAt: "2026-04-27T10:00:00.000Z",
  query: "what is recall",
  result: { ok: true as const, citationCount: 2 },
};

const OK_FALSE_ENTRY = {
  id: "2026-04-27T09-00-00-000Z-bbbbbb",
  createdAt: "2026-04-27T09:00:00.000Z",
  query: "nothing matches",
  result: { ok: false as const, reason: "no_hits" as const },
};

const MIXED_LOG: AnswerHistoryListResult = {
  entries: [OK_TRUE_ENTRY, OK_FALSE_ENTRY],
};

const EMPTY_LOG: AnswerHistoryListResult = { entries: [] };

const OK_TRUE_RESULT: AnswerResult = {
  ok: true,
  answer:
    "KOTA recall fans out [source:k-1] across stores [source:task-recall].",
  citations: [
    { source: "knowledge", id: "k-1" },
    { source: "tasks", id: "task-recall" },
  ],
  hits: [
    {
      source: "knowledge",
      score: 0.9,
      id: "k-1",
      title: "Recall design",
      preview: "...",
      updated: "2026-04-26",
    },
    {
      source: "tasks",
      score: 0.8,
      id: "task-recall",
      title: "Add recall seam",
      state: "doing",
      priority: "p2",
      updatedAt: "2026-04-27",
    },
  ],
};

function makeShow(result: AnswerResult): AnswerHistoryShowResult {
  const record: AnswerHistoryRecord = {
    id: OK_TRUE_ENTRY.id,
    createdAt: OK_TRUE_ENTRY.createdAt,
    query: OK_TRUE_ENTRY.query,
    filter: {},
    recallHits: [],
    result,
  };
  return { ok: true, record };
}

const NOT_FOUND_SHOW: AnswerHistoryShowResult = {
  ok: false,
  reason: "not_found",
};

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchByPath(responses: Record<string, () => unknown>): FetchMock {
  const fn = vi.fn((input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const path = url.split("?")[0] ?? url;
    const route = responses[path] ?? responses[url];
    if (!route) {
      throw new Error(`Unexpected fetch path: ${url}`);
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(route()),
    });
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn as unknown as FetchMock;
}

describe("AnswerHistoryPanel", () => {
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

  it("log mode renders a mixed ok:true / ok:false projection with the typed badges and queries", async () => {
    mockFetchByPath({ "/api/answers": () => MIXED_LOG });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerHistoryPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("what is recall")).toBeInTheDocument(),
    );
    expect(screen.getByText("nothing matches")).toBeInTheDocument();
    expect(screen.getByText("ok(2)")).toBeInTheDocument();
    expect(screen.getByText("no_hits")).toBeInTheDocument();
  });

  it("log mode renders the empty-history fixed message when entries is empty", async () => {
    mockFetchByPath({ "/api/answers": () => EMPTY_LOG });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerHistoryPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByText("No answers in history yet."),
      ).toBeInTheDocument(),
    );
  });

  it("clicking a log row opens show mode for that id and renders the ok:true arm", async () => {
    mockFetchByPath({
      "/api/answers": () => MIXED_LOG,
      [`/api/answers/${OK_TRUE_ENTRY.id}`]: () => makeShow(OK_TRUE_RESULT),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerHistoryPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("what is recall")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("what is recall"));

    await waitFor(() =>
      expect(
        screen.getByText(
          /KOTA recall fans out \[source:k-1\] across stores \[source:task-recall\]\./,
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(OK_TRUE_ENTRY.id)).toBeInTheDocument();
    expect(screen.getByText(OK_TRUE_ENTRY.createdAt)).toBeInTheDocument();
  });

  it("show mode renders the no_hits arm distinct from the other failure arms", async () => {
    mockFetchByPath({
      "/api/answers": () => MIXED_LOG,
      [`/api/answers/${OK_TRUE_ENTRY.id}`]: () =>
        makeShow({ ok: false, reason: "no_hits" }),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerHistoryPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("what is recall")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("what is recall"));

    await waitFor(() =>
      expect(
        screen.getByText("No matching sources for this question."),
      ).toBeInTheDocument(),
    );
  });

  it("show mode renders the semantic_unavailable arm", async () => {
    mockFetchByPath({
      "/api/answers": () => MIXED_LOG,
      [`/api/answers/${OK_TRUE_ENTRY.id}`]: () =>
        makeShow({ ok: false, reason: "semantic_unavailable" }),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerHistoryPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("what is recall")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("what is recall"));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Answer unavailable — no recall contributors registered.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("show mode renders the synthesis_failed arm", async () => {
    mockFetchByPath({
      "/api/answers": () => MIXED_LOG,
      [`/api/answers/${OK_TRUE_ENTRY.id}`]: () =>
        makeShow({ ok: false, reason: "synthesis_failed" }),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerHistoryPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("what is recall")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("what is recall"));

    await waitFor(() =>
      expect(
        screen.getByText("Could not compose a cited answer for this question."),
      ).toBeInTheDocument(),
    );
  });

  it("show mode renders the not_found fixed message when the seam reports a missing id", async () => {
    mockFetchByPath({
      "/api/answers": () => MIXED_LOG,
      [`/api/answers/${OK_TRUE_ENTRY.id}`]: () => NOT_FOUND_SHOW,
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerHistoryPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("what is recall")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByText("what is recall"));

    await waitFor(() =>
      expect(
        screen.getByText("No answer record with that id."),
      ).toBeInTheDocument(),
    );
  });
});
