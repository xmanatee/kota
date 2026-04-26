/**
 * AttentionPanel test — exercises the panel through the same /api/attention
 * surface the daemon route exposes, asserting:
 *
 *  - items-present payload renders the rendered text body and an "N items" label
 *  - empty-items payload (NO_ATTENTION_ITEMS_TEXT) renders a "nothing pending" label
 *  - failed /api/attention surfaces the daemon's error one-to-one
 */

import type { AttentionResponse } from "@/api/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttentionPanel } from "./AttentionPanel";

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

const ITEMS_PAYLOAD: AttentionResponse = {
  data: {
    items: [
      { label: "Empty ready queue", detail: "Builder has nothing to pull." },
      {
        label: "Empty backlog",
        detail: "No reserves for explorer to promote.",
      },
    ],
  },
  text:
    "Attention digest (2 items):\n" +
    "• *Empty ready queue*: Builder has nothing to pull.\n" +
    "• *Empty backlog*: No reserves for explorer to promote.",
};

const EMPTY_PAYLOAD: AttentionResponse = {
  data: { items: [] },
  text: "No attention items right now.",
};

describe("AttentionPanel", () => {
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

  it("renders the rendered body and an item count for an items-present payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(ITEMS_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AttentionPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/Empty ready queue.*Builder has nothing to pull/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.queryByText("nothing pending")).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/attention",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("labels empty payloads as 'nothing pending' and renders the no-items reply", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(EMPTY_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AttentionPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText("nothing pending")).toBeInTheDocument(),
    );
    expect(screen.queryByText(/items$/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/No attention items right now\./),
    ).toBeInTheDocument();
  });

  it("surfaces the daemon's typed error when /api/attention fails", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve("attention unavailable"),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <AttentionPanel />
      </Wrapper>,
    );

    await waitFor(() =>
      expect(screen.getByText(/attention unavailable/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/API error 503/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
