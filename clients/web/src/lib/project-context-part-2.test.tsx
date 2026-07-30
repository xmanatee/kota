import { Sidebar } from "@/components/sidebar/Sidebar";
import { ProjectProvider, parseProjectHash } from "@/lib/project-context";
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
            projectName: "Solo",
            projectDir: "/projects/solo",
            projects: {
              defaultProjectId: "solo",
              projects: [
                {
                  projectId: "solo",
                  projectDir: "/projects/solo",
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
        <ProjectProvider>{children}</ProjectProvider>
      </QueryClientProvider>
    );
  };
}

function noop(): void {}

describe("project context parsing and single-project rendering", () => {
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

  it("parses #p/<projectId>/<sub> hashes", () => {
    expect(parseProjectHash("#p/alpha/run/r1")).toEqual({
      projectId: "alpha",
      subRoute: "run/r1",
    });
    expect(parseProjectHash("#p/alpha")).toEqual({
      projectId: "alpha",
      subRoute: "",
    });
    expect(parseProjectHash("#run/r1")).toEqual({
      projectId: null,
      subRoute: "run/r1",
    });
    expect(parseProjectHash("")).toEqual({ projectId: null, subRoute: "" });
  });

  it("hides the selector when the daemon hosts exactly one project", async () => {
    globalThis.fetch = makeFetchMock() as unknown as typeof fetch;
    const Wrapper = makeWrapper();
    render(
      <Wrapper>
        <Sidebar
          collapsed={false}
          onToggle={noop}
          activeSessionId={null}
          onSessionSelect={noop}
          onHistorySelect={noop}
          onRunSelect={noop}
          onCompareRuns={(_a: string, _b: string) => undefined}
          onNewChat={noop}
          connectionStatus="connected"
          darkMode={false}
          onToggleTheme={noop}
        />
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText(/active project/i),
      ).not.toBeInTheDocument(),
    );
  });
});
