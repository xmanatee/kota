import { uiSurfacesQuery } from "@/api/queries";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ScopeProvider, useScopeId } from "@/lib/scope-context";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCOPES = {
  rootScopeId: "global",
  defaultScopeId: "alpha",
  scopes: [
    { scopeId: "global", displayName: "Global" },
    {
      scopeId: "alpha",
      parentScopeId: "global",
      directoryRoot: "/scopes/alpha",
      displayName: "Alpha",
    },
    {
      scopeId: "beta",
      parentScopeId: "global",
      directoryRoot: "/scopes/beta",
      displayName: "Beta",
    },
  ],
};

type FetchInput = string | URL | Request;

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function readScopeId(url: string): string | null {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return null;
  const params = new URLSearchParams(url.slice(qIndex + 1));
  return params.get("scopeId");
}

function makeFetchMock(): {
  mock: ReturnType<typeof vi.fn>;
  calls: Array<{ path: string; scopeId: string | null }>;
} {
  const calls: Array<{ path: string; scopeId: string | null }> = [];
  const mock = vi.fn(async (input: FetchInput) => {
    const url = urlOf(input);
    const path = url.split("?")[0] ?? url;
    const scopeId = readScopeId(url);
    calls.push({ path, scopeId });
    if (path === "/identity") {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            scopeName: "Alpha",
            scopeRoot: "/scopes/alpha",
            scopeRegistry: SCOPES,
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "2026-05-08T00:00:00.000Z",
            dashboard: { available: false, reason: "test" },
          }),
      } as Response;
    }
    if (path === "/ui/surfaces") {
      const id = scopeId === "beta" ? "beta" : "alpha";
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            protocolVersion: "ui.surface.v1",
            surfaces: [
              {
                protocolVersion: "ui.surface.v1",
                surfaceId: "status",
                extensionId: "test.status",
                title: `${id}-session`,
                intent: "Status",
                scopeId: id,
                attachmentPoint: { kind: "root" },
                order: 10,
                nodes: [],
                actions: [],
              },
            ],
          }),
      } as Response;
    }
    return {
      ok: true,
      json: () => Promise.resolve({}),
    } as Response;
  });
  return { mock, calls };
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
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ScopeProvider>{children}</ScopeProvider>
      </QueryClientProvider>
    );
  };
}

function noop(): void {}

function ScopedSidebar() {
  const scopeId = useScopeId();
  const surfaces = useQuery(uiSurfacesQuery(scopeId));
  return (
    <Sidebar
      collapsed={false}
      onToggle={noop}
      onNewChat={noop}
      connectionStatus="connected"
      darkMode={false}
      onToggleTheme={noop}
      uiBundle={surfaces.data}
      uiLoading={surfaces.isPending}
      uiError={surfaces.error}
      selectedSurfaceId={null}
      onSurfaceSelect={noop}
    />
  );
}

describe("scope selector + scope-scoped routing", () => {
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
    Object.defineProperty(window, "location", {
      value: { search: "", pathname: "/", hash: "" },
      writable: true,
    });
  });

  it("renders the selector, scopes fetches to the active scope, and switches without leaking rows", async () => {
    const { mock, calls } = makeFetchMock();
    globalThis.fetch = mock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <ScopedSidebar />
      </Wrapper>,
    );

    // Selector shows once identity has loaded.
    const selector = await screen.findByLabelText(/active scope/i);
    expect(selector).toBeInTheDocument();
    expect(selector).toHaveValue("alpha");
    const options = Array.from(
      selector.querySelectorAll("option"),
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(["alpha", "beta"]);

    // Alpha's shared surface appears.
    await waitFor(() =>
      expect(screen.getByText(/alpha-sessio/)).toBeInTheDocument(),
    );

    // Every scope-scoped fetch carried `?scopeId=alpha`.
    const alphaScopedPaths = calls
      .filter((c) => c.scopeId === "alpha")
      .map((c) => c.path);
    expect(alphaScopedPaths).toContain("/ui/surfaces");
    expect(calls.some((c) => c.scopeId !== null && c.scopeId !== "alpha")).toBe(
      false,
    );

    // Switch to Beta.
    fireEvent.change(selector, { target: { value: "beta" } });

    expect(window.location.hash).toBe("#s/beta");

    await waitFor(() =>
      expect(screen.getByText(/beta-sessio/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/alpha-sessio/)).not.toBeInTheDocument();

    // After the switch, scope-scoped fetches now carry `?scopeId=beta`.
    const betaCalls = calls
      .filter((c) => c.scopeId === "beta")
      .map((c) => c.path);
    expect(betaCalls).toContain("/ui/surfaces");
  });
});
