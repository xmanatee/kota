/**
 * AnswerPanel test — exercises the panel through the same /api/answer surface
 * the daemon route exposes, asserting that each branch of the discriminated
 * `AnswerResult` renders its own distinct view:
 *
 *  - `ok: true` with cited prose and hits across two source arms → prose +
 *    one citation row per citation, each resolved by lookup against `hits`
 *  - `ok: false` with `reason: "no_hits"` → fixed message
 *  - `ok: false` with `reason: "semantic_unavailable"` → fixed message
 *  - `ok: false` with `reason: "synthesis_failed"` → fixed message
 *
 * Submission is gated to non-empty queries — an Enter on a blank input must
 * not fire `/api/answer`.
 */

import type { AnswerResult } from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerPanel } from "./AnswerPanel";

function makeWrapper(): {
  Wrapper: ({ children }: { children: ReactNode }) => ReactElement;
  client: QueryClient;
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
  return { Wrapper, client };
}

const COMPOSED_ANSWER: AnswerResult = {
  ok: true,
  answer:
    "KOTA recall fans out across stores [source:k-1] and ranks them with stable tie-breaking [source:task-recall].",
  citations: [
    { source: "knowledge", id: "k-1" },
    { source: "tasks", id: "task-recall" },
  ],
  hits: [
    {
      source: "knowledge",
      score: 0.94,
      id: "k-1",
      title: "Recall design",
      preview: "...",
      updated: "2026-04-26",
    },
    {
      source: "tasks",
      score: 0.81,
      id: "task-recall",
      title: "Add recall seam",
      state: "doing",
      priority: "p2",
      updatedAt: "2026-04-27",
    },
  ],
};

const NO_HITS: AnswerResult = { ok: false, reason: "no_hits" };
const UNAVAILABLE: AnswerResult = {
  ok: false,
  reason: "semantic_unavailable",
};
const SYNTHESIS_FAILED: AnswerResult = {
  ok: false,
  reason: "synthesis_failed",
};

function submitQuery(query: string): void {
  const input = screen.getByPlaceholderText(/Ask the second brain/);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: /answer/i }));
}

describe("AnswerPanel", () => {
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

  it("renders cited prose and one citation row per citation across two source arms", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(COMPOSED_ANSWER),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerPanel />
      </Wrapper>,
    );
    submitQuery("what is recall");

    await waitFor(() =>
      expect(
        screen.getByText(
          /KOTA recall fans out across stores \[source:k-1\] and ranks them with stable tie-breaking \[source:task-recall\]\./,
        ),
      ).toBeInTheDocument(),
    );

    expect(screen.getByText("knowledge")).toBeInTheDocument();
    expect(screen.getByText("tasks")).toBeInTheDocument();
    expect(screen.getByText("k-1")).toBeInTheDocument();
    expect(screen.getByText("task-recall")).toBeInTheDocument();
    expect(screen.getByText("Recall design")).toBeInTheDocument();
    expect(screen.getByText("[doing/p2] Add recall seam")).toBeInTheDocument();
    expect(screen.getByText("0.940")).toBeInTheDocument();
    expect(screen.getByText("0.810")).toBeInTheDocument();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/answer",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "what is recall" }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("renders the no-hits message when the seam returns no_hits", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(NO_HITS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerPanel />
      </Wrapper>,
    );
    submitQuery("nothingthere");

    await waitFor(() =>
      expect(
        screen.getByText("No matching sources for this question."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Answer unavailable/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Could not compose/)).not.toBeInTheDocument();
  });

  it("renders the unavailable message when the seam reports semantic_unavailable", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(UNAVAILABLE),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerPanel />
      </Wrapper>,
    );
    submitQuery("anything");

    await waitFor(() =>
      expect(
        screen.getByText(
          "Answer unavailable — no recall contributors registered.",
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("No matching sources for this question."),
    ).not.toBeInTheDocument();
  });

  it("renders the synthesis-failed message when the seam reports synthesis_failed", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SYNTHESIS_FAILED),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerPanel />
      </Wrapper>,
    );
    submitQuery("anything");

    await waitFor(() =>
      expect(
        screen.getByText("Could not compose a cited answer for this question."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("No matching sources for this question."),
    ).not.toBeInTheDocument();
  });

  it("does not call /api/answer on submit with a blank query", () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(NO_HITS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AnswerPanel />
      </Wrapper>,
    );
    const input = screen.getByPlaceholderText(/Ask the second brain/);
    fireEvent.change(input, { target: { value: "   " } });
    const button = screen.getByRole("button", { name: /answer/i });
    expect(button).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
