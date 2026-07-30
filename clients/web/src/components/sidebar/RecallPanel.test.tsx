/**
 * RecallPanel test — exercises the panel through the same /api/recall surface
 * the daemon route exposes, asserting that each branch of the discriminated
 * `RecallResult` renders its own distinct view:
 *
 *  - `ok: false` with `reason: "semantic_unavailable"` → unavailable message
 *  - `ok: true` with empty hits → "No matching hits."
 *  - `ok: true` with ranked hits → one row per hit with source badge,
 *    description, and normalized score, in the order the seam returned them
 *
 * Submission is gated to non-empty queries — an Enter on a blank input must
 * not fire `/api/recall`.
 */

import type { RecallResult } from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import renderFixtureJson from "../../../../conformance/recall-render-fixture.json";
import { RecallPanel } from "./RecallPanel";

type RecallRenderFixture = {
  populated: { result: Extract<RecallResult, { ok: true }> };
  empty: { result: Extract<RecallResult, { ok: true }> };
  semanticUnavailable: { result: Extract<RecallResult, { ok: false }> };
};

const renderFixture = renderFixtureJson as RecallRenderFixture;

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

const RANKED_HITS: RecallResult = renderFixture.populated.result;
const EMPTY_HITS: RecallResult = renderFixture.empty.result;
const UNAVAILABLE: RecallResult = renderFixture.semanticUnavailable.result;

function submitQuery(query: string): void {
  const input = screen.getByPlaceholderText(/Recall across stores/);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: /recall/i }));
}

describe("RecallPanel", () => {
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

  it("renders ranked hits with source badges and scores in seam order", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(RANKED_HITS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RecallPanel />
      </Wrapper>,
    );
    submitQuery("recall");

    await waitFor(() =>
      expect(
        screen.getByText(/^Cross-store recall fan-out \|/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("knowledge")).toBeInTheDocument();
    expect(screen.getByText("memory")).toBeInTheDocument();
    expect(screen.getByText("history")).toBeInTheDocument();
    expect(screen.getByText("tasks")).toBeInTheDocument();
    expect(screen.getAllByText("answer")).toHaveLength(2);
    expect(
      screen.getByText("[ready/p2] Wire recall surfaces"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("[ok(2)] How does the harness boundary work?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("[semantic_unavailable] Why did synthesis fail?"),
    ).toBeInTheDocument();
    expect(screen.getByText("0.912")).toBeInTheDocument();
    expect(screen.getByText("0.834")).toBeInTheDocument();
    expect(screen.getByText("0.712")).toBeInTheDocument();
    expect(screen.getByText("0.633")).toBeInTheDocument();
    expect(screen.getByText("0.521")).toBeInTheDocument();
    expect(screen.getByText("0.409")).toBeInTheDocument();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/recall",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ query: "recall" }),
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });

  it("renders 'No matching hits.' for an empty ok payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(EMPTY_HITS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RecallPanel />
      </Wrapper>,
    );
    submitQuery("nothingthere");

    await waitFor(() =>
      expect(screen.getByText("No matching hits.")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Recall unavailable/)).not.toBeInTheDocument();
  });

  it("renders the unavailable message when the seam reports semantic_unavailable", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(UNAVAILABLE),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RecallPanel />
      </Wrapper>,
    );
    submitQuery("anything");

    await waitFor(() =>
      expect(
        screen.getByText("Recall unavailable — no contributors registered"),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("No matching hits.")).not.toBeInTheDocument();
  });

  it("does not call /api/recall on submit with a blank query", () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(EMPTY_HITS),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <RecallPanel />
      </Wrapper>,
    );
    const input = screen.getByPlaceholderText(/Recall across stores/);
    fireEvent.change(input, { target: { value: "   " } });
    const button = screen.getByRole("button", { name: /recall/i });
    expect(button).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
