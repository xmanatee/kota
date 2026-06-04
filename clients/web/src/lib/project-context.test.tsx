import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { ProjectProvider, parseProjectHash } from "@/lib/project-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Integration test for the project selector and project-scoped query
 * routing. Boots the dashboard with two daemon projects and asserts:
 *
 *  - the header selector lists both projects
 *  - the active project drives every project-scoped fetch
 *    (`?projectId=<id>`)
 *  - switching projects updates the URL hash
 *    (`#p/<projectId>/...`) and re-fetches the per-project rows
 *  - rows from the previous project never leak into the new view
 *
 * This is the web-client side of the multi-project supervision contract;
 * the daemon side is covered by the daemon control-API conformance suite.
 */

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
      "[data-testid='project-selector']{padding:8px;border:1px solid #ccc;background:#fff}",
      "select{margin-left:8px;padding:2px 6px;font-size:12px}",
      ".panel{margin-top:1rem;padding:8px;border:1px solid #eee;background:#fff}",
      "</style></head><body>",
      html,
      "</body></html>",
    ].join("\n"),
  );
}

const PROJECTS = {
  defaultProjectId: "alpha",
  projects: [
    {
      projectId: "alpha",
      projectDir: "/projects/alpha",
      displayName: "Alpha",
    },
    {
      projectId: "beta",
      projectDir: "/projects/beta",
      displayName: "Beta",
    },
  ],
};

const SESSIONS_BY_PROJECT: Record<
  string,
  Array<{
    id: string;
    scopeId: string;
    projectId: string;
    createdAt: string;
    lastActive: number;
    autonomyMode: "passive" | "supervised" | "autonomous";
  }>
> = {
  alpha: [
    {
      id: "alpha-session-id-aaaaaaaa",
      scopeId: "alpha",
      projectId: "alpha",
      createdAt: "2026-05-08T01:00:00.000Z",
      lastActive: 0,
      autonomyMode: "supervised",
    },
  ],
  beta: [
    {
      id: "beta-session-id-bbbbbbbb",
      scopeId: "beta",
      projectId: "beta",
      createdAt: "2026-05-08T01:30:00.000Z",
      lastActive: 0,
      autonomyMode: "autonomous",
    },
  ],
};

type FetchInput = string | URL | Request;

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function readProjectId(url: string): string | null {
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return null;
  const params = new URLSearchParams(url.slice(qIndex + 1));
  return params.get("projectId");
}

function emptyWorkflowStatus(): unknown {
  return {
    activeRuns: [],
    pendingRuns: [],
    queueLength: 0,
    completedRuns: 0,
    paused: false,
    agentConcurrency: 1,
    codeConcurrency: 4,
    workflows: {},
  };
}

function makeFetchMock(): {
  mock: ReturnType<typeof vi.fn>;
  calls: Array<{ path: string; projectId: string | null }>;
} {
  const calls: Array<{ path: string; projectId: string | null }> = [];
  const mock = vi.fn(async (input: FetchInput) => {
    const url = urlOf(input);
    const path = url.split("?")[0] ?? url;
    const projectId = readProjectId(url);
    calls.push({ path, projectId });
    if (path === "/identity") {
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            projectName: "Alpha",
            projectDir: "/projects/alpha",
            projects: PROJECTS,
            daemonVersion: "0.1.0",
            pid: 1,
            startedAt: "2026-05-08T00:00:00.000Z",
            dashboard: { available: false, reason: "test" },
          }),
      } as Response;
    }
    if (path === "/api/sessions") {
      const id = projectId === "beta" ? "beta" : "alpha";
      return {
        ok: true,
        json: () =>
          Promise.resolve({ sessions: SESSIONS_BY_PROJECT[id] ?? [] }),
      } as Response;
    }
    if (path === "/api/workflow/status") {
      return {
        ok: true,
        json: () => Promise.resolve(emptyWorkflowStatus()),
      } as Response;
    }
    if (path === "/api/workflow/definitions") {
      return {
        ok: true,
        json: () => Promise.resolve({ definitions: [] }),
      } as Response;
    }
    if (path === "/api/workflow/runs") {
      return {
        ok: true,
        json: () => Promise.resolve({ runs: [] }),
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
        <ProjectProvider>{children}</ProjectProvider>
      </QueryClientProvider>
    );
  };
}

function noop(): void {}

describe("project selector + project-scoped routing", () => {
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

  it("renders the selector, scopes fetches to the active project, and switches without leaking rows", async () => {
    const { mock, calls } = makeFetchMock();
    globalThis.fetch = mock as unknown as typeof fetch;

    const Wrapper = makeWrapper();
    const { container } = render(
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

    // Selector shows once identity has loaded.
    const selector = await screen.findByLabelText(/active project/i);
    expect(selector).toBeInTheDocument();
    expect(selector).toHaveValue("alpha");
    const options = Array.from(
      selector.querySelectorAll("option"),
    ) as HTMLOptionElement[];
    expect(options.map((o) => o.value)).toEqual(["alpha", "beta"]);

    // Alpha's session row appears.
    await waitFor(() =>
      expect(screen.getByText(/alpha-sessio/)).toBeInTheDocument(),
    );

    // Every project-scoped fetch carried `?projectId=alpha`.
    const alphaScopedPaths = calls
      .filter((c) => c.projectId === "alpha")
      .map((c) => c.path);
    expect(alphaScopedPaths).toContain("/api/sessions");
    expect(
      calls.some((c) => c.projectId !== null && c.projectId !== "alpha"),
    ).toBe(false);

    emitEvidence(
      "web-project-selector-alpha.html",
      `<div class="panel">${container.innerHTML}</div>`,
    );

    // Switch to Beta.
    fireEvent.change(selector, { target: { value: "beta" } });

    expect(window.location.hash).toBe("#p/beta");

    await waitFor(() =>
      expect(screen.getByText(/beta-sessio/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/alpha-sessio/)).not.toBeInTheDocument();

    // After the switch, project-scoped fetches now carry `?projectId=beta`.
    const betaCalls = calls
      .filter((c) => c.projectId === "beta")
      .map((c) => c.path);
    expect(betaCalls).toContain("/api/sessions");

    emitEvidence(
      "web-project-selector-beta.html",
      `<div class="panel">${container.innerHTML}</div>`,
    );
  });

  it("hides the selector when the daemon hosts exactly one project", async () => {
    const { mock } = makeFetchMockSingle();
    globalThis.fetch = mock as unknown as typeof fetch;
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
    // Wait for identity then assert no selector.
    await waitFor(() =>
      expect(
        screen.queryByLabelText(/active project/i),
      ).not.toBeInTheDocument(),
    );
  });
});

function makeFetchMockSingle(): { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn(async (input: FetchInput) => {
    const url = urlOf(input);
    const path = url.split("?")[0];
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
  return { mock };
}
