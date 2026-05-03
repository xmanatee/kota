/**
 * KnowledgePanel test — exercises the panel through the same shared
 * `/api/knowledge/search?q=&semantic=true&limit=` seam every other operator
 * pull-surface (Telegram `/knowledge`, terminal `kota knowledge search`,
 * mobile `KnowledgeScreen`, macOS `KnowledgeView`) consumes. The fixture
 * payloads come from the canonical `clients/conformance/contract-fixture.json`
 * so payload drift fails this suite together with the macOS Swift suite,
 * the mobile Jest suite, and the web `contractFixture.test.ts`.
 *
 * Three arms covered: semantic-supported populated entries, empty-result
 * state, and `semantic_unavailable` caption. Submission is gated to
 * non-empty queries.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../../conformance/contract-fixture.json";
import { KnowledgePanel } from "./KnowledgePanel";

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

const SUCCESS_PAYLOAD = fixture.knowledgeSearch.success;
const SEMANTIC_UNAVAILABLE_PAYLOAD =
  fixture.knowledgeSearch.semanticUnavailable;
const EMPTY_PAYLOAD = { ok: true, entries: [] };

function submitQuery(query: string): void {
  const input = screen.getByPlaceholderText(/Search knowledge/);
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: /search/i }));
}

describe("KnowledgePanel", () => {
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

  it("renders the four-column entry shape from the conformance fixture", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SUCCESS_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <KnowledgePanel />
      </Wrapper>,
    );
    submitQuery("harness");

    await waitFor(() => {
      expect(
        screen.getByText(/Pluggable harness protocol/),
      ).toBeInTheDocument();
    });
    const body =
      screen.getByText(/Pluggable harness protocol/).textContent ?? "";
    expect(body).toContain("kn-42");
    expect(body).toContain("kn-43");
    expect(body).toContain("decision");
    expect(body).toContain("reference");
    expect(body).toContain("active");
    expect(body).toContain("Daemon control protocol");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/knowledge/search?q=harness&semantic=true&limit=10",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("renders 'No matching knowledge entries.' on an empty ok payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(EMPTY_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <KnowledgePanel />
      </Wrapper>,
    );
    submitQuery("nothingthere");

    await waitFor(() =>
      expect(
        screen.getByText("No matching knowledge entries."),
      ).toBeInTheDocument(),
    );
  });

  it("renders the semantic-unavailable caption from the conformance fixture", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(SEMANTIC_UNAVAILABLE_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <KnowledgePanel />
      </Wrapper>,
    );
    submitQuery("anything");

    await waitFor(() =>
      expect(
        screen.getByText(
          "Semantic knowledge search requires an embedding-backed knowledge provider.",
        ),
      ).toBeInTheDocument(),
    );
  });

  it("does not call /api/knowledge/search on submit with a blank query", () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(EMPTY_PAYLOAD),
    });

    const { Wrapper } = makeWrapper();
    render(
      <Wrapper>
        <KnowledgePanel />
      </Wrapper>,
    );
    const input = screen.getByPlaceholderText(/Search knowledge/);
    fireEvent.change(input, { target: { value: "   " } });
    const button = screen.getByRole("button", { name: /search/i });
    expect(button).toBeDisabled();
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
