import { Sidebar } from "@/components/sidebar/Sidebar";
import { ScopeProvider, parseScopeHash } from "@/lib/scope-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchInput = string | URL | Request;

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function makeFetchMock(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: FetchInput) => {
    const path = urlOf(input).split("?")[0];
    if (path === "/identity") {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            scopeName: "Solo",
            scopeRoot: "/scopes/solo",
            scopeRegistry: {
              rootScopeId: "global",
              defaultScopeId: "solo",
              scopes: [
                { scopeId: "global", displayName: "Global" },
                {
                  scopeId: "solo",
                  parentScopeId: "global",
                  directoryRoot: "/scopes/solo",
                  displayName: "Solo",
                },
              ],
            },
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "2026-05-08T00:00:00.000Z",
            dashboard: { available: false, reason: "test" },
          }),
      } as Response;
    }
    return {
      ok: true,
      json: () => Promise.resolve({ sessions: [] }),
    } as Response;
  });
}

function makeWrapper(): ({
  children,
}: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return (
      <QueryClientProvider client={client}>
        <ScopeProvider>{children}</ScopeProvider>
      </QueryClientProvider>
    );
  };
}

function noop(): void {}

describe("scope context parsing and single-scope rendering", () => {
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

  it("parses #s/<scopeId>/<sub> hashes", () => {
    expect(parseScopeHash("#s/alpha/run/r1")).toEqual({
      scopeId: "alpha",
      subRoute: "run/r1",
    });
    expect(parseScopeHash("#s/alpha")).toEqual({
      scopeId: "alpha",
      subRoute: "",
    });
    expect(parseScopeHash("#run/r1")).toEqual({
      scopeId: null,
      subRoute: "run/r1",
    });
    expect(parseScopeHash("")).toEqual({ scopeId: null, subRoute: "" });
  });

  it("hides the selector when the daemon hosts exactly one directory scope", async () => {
    globalThis.fetch = makeFetchMock() as unknown as typeof fetch;
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Sidebar
          collapsed={false}
          onToggle={noop}
          onNewChat={noop}
          connectionStatus="connected"
          darkMode={false}
          onToggleTheme={noop}
          uiBundle={{ protocolVersion: "ui.surface.v1", surfaces: [] }}
          uiLoading={false}
          uiError={null}
          selectedSurfaceId={null}
          onSurfaceSelect={noop}
        />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(screen.queryByLabelText(/active scope/i)).not.toBeInTheDocument(),
    );
  });
});
