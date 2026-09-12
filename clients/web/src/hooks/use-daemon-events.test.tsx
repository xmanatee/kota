import { queryKeys } from "@/api/queries";
import { ScopeProvider, useScopeContext } from "@/lib/scope-context";
import { TestScopeProvider } from "@/lib/scope-context.test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../conformance/ui-behavior-vectors.generated.json";
import { parseUiSurfaceBundle } from "../../../conformance/ui-surface.generated";
import { useDaemonEvents } from "./use-daemon-events";

const OriginalEventSource = globalThis.EventSource;

class TestEventSource {
  static latest: TestEventSource | null = null;
  readonly listeners = new Map<string, Set<EventListener>>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    TestEventSource.latest = this;
  }

  addEventListener(event: string, listener: EventListener) {
    const listeners = this.listeners.get(event) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
  }

  removeEventListener(event: string, listener: EventListener) {
    this.listeners.get(event)?.delete(listener);
  }

  close() {}

  emit(event: string, payload: unknown, id = "") {
    const message = new MessageEvent(event, {
      data: JSON.stringify(payload),
      lastEventId: id,
    });
    for (const listener of this.listeners.get(event) ?? []) listener(message);
  }
}

afterEach(() => {
  Object.defineProperty(globalThis, "EventSource", {
    configurable: true,
    value: OriginalEventSource,
  });
  TestEventSource.latest = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.location.hash = "";
});

describe("useDaemonEvents shared UI refresh", () => {
  it("derives graph refresh and live-log subscriptions from the bundle", async () => {
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: TestEventSource,
    });
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <TestScopeProvider scopeId="scope-a">{children}</TestScopeProvider>
      </QueryClientProvider>
    );

    const fixtureBundle = parseUiSurfaceBundle(fixture.operatorBundle);
    const bundle = {
      ...fixtureBundle,
      surfaces: fixtureBundle.surfaces.map((surface, index) =>
        index === 0 ? { ...surface, refreshEvents: ["task.changed"] } : surface,
      ),
    };
    const { result } = renderHook(() => useDaemonEvents(bundle), { wrapper });
    await waitFor(() => expect(TestEventSource.latest).not.toBeNull());

    act(() => {
      TestEventSource.latest?.emit("task.changed", {
        scopeId: "scope-a",
      });
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.uiSurfaces("scope-a"),
      });
    });

    act(() => {
      TestEventSource.latest?.emit("workflow.run.completed", {
        scopeId: "scope-a",
        timestamp: "2026-08-02T18:30:00.000Z",
        message: "Builder run completed.",
      });
    });

    expect(result.current.liveLogEntries["daemon-events"]).toContainEqual({
      timestamp: "2026-08-02T18:30:00.000Z",
      level: "info",
      source: "workflow.run.completed",
      message: "Builder run completed.",
    });
  });
});

// Production scope selection + hook + QueryClient; only the HTTP/SSE ports are controlled.
it("isolates the selected dashboard through switching, retired callbacks and replay", () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", TestEventSource);
  window.location.hash = "#s/scope-a";
  const queryClient = new QueryClient();
  queryClient.setQueryData(["identity"], {
    scopeRegistry: {
      rootScopeId: "global",
      defaultScopeId: "scope-a",
      scopes: [
        { scopeId: "global", displayName: "Global" },
        { scopeId: "scope-a", directoryRoot: "/a", displayName: "A" },
        { scopeId: "scope-b", directoryRoot: "/b", displayName: "B" },
      ],
    },
  });
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const fixtureBundle = parseUiSurfaceBundle(fixture.operatorBundle);
  const bundle = {
    ...fixtureBundle,
    surfaces: fixtureBundle.surfaces.map((surface) => ({
      ...surface,
      refreshEvents: [...(surface.refreshEvents ?? []), "daemon.config.reload"],
    })),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ScopeProvider>{children}</ScopeProvider>
    </QueryClientProvider>
  );
  const { result, unmount } = renderHook(
    () => ({
      events: useDaemonEvents(bundle),
      scope: useScopeContext(),
    }),
    { wrapper },
  );
  const first = TestEventSource.latest!;
  expect(first.url).toBe("/api/daemon/events?scopeId=scope-a");
  act(() => {
    first.emit("workflow.run.completed", {
      scopeId: "scope-b",
      message: "scope-b-private-sentinel",
    });
    first.emit("workflow.run.completed", { message: "missing-scope" });
    first.emit("session.registered", { scopeId: "scope-b" });
    first.emit("session.registered", { scopeId: null });
  });
  expect(result.current.events.liveLogEntries).toEqual({});
  expect(invalidate).not.toHaveBeenCalled();
  act(() =>
    first.emit(
      "workflow.run.completed",
      { scopeId: "scope-a", message: "A" },
      "epoch:1",
    ),
  );
  expect(
    result.current.events.liveLogEntries["daemon-events"]?.map(
      (entry) => entry.message,
    ),
  ).toEqual(["A"]);
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: queryKeys.uiSurfaces("scope-a"),
  });

  act(() => result.current.scope.setScopeId("scope-b"));
  const second = TestEventSource.latest!;
  expect(second.url).toBe("/api/daemon/events?scopeId=scope-b");
  expect(result.current.events.liveLogEntries).toEqual({});
  invalidate.mockClear();
  act(() => {
    first.emit("workflow.run.completed", {
      scopeId: "scope-a",
      message: "late A",
    });
    first.onopen?.();
    first.onerror?.();
  });
  expect(invalidate).not.toHaveBeenCalled();
  expect(result.current.events.liveLogEntries).toEqual({});
  act(() =>
    second.emit(
      "workflow.run.completed",
      { scopeId: "scope-b", message: "B live" },
      "epoch:2",
    ),
  );
  act(() => {
    second.onerror?.();
    vi.advanceTimersByTime(10000);
  });
  const reconnected = TestEventSource.latest!;
  expect(reconnected.url).toBe(
    "/api/daemon/events?scopeId=scope-b&after=epoch%3A2",
  );
  invalidate.mockClear();
  act(() => {
    second.emit(
      "workflow.run.completed",
      { scopeId: "scope-b", message: "retired B" },
      "epoch:99",
    );
    reconnected.emit(
      "workflow.run.completed",
      { scopeId: "scope-a", message: "foreign replay" },
      "epoch:3",
    );
  });
  expect(invalidate).not.toHaveBeenCalled();
  act(() =>
    reconnected.emit(
      "workflow.run.completed",
      { scopeId: "scope-b", message: "B replay" },
      "epoch:4",
    ),
  );
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(
    result.current.events.liveLogEntries["daemon-events"]?.map(
      (entry) => entry.message,
    ),
  ).toEqual(["B live", "B replay"]);
  invalidate.mockClear();
  act(() => reconnected.emit("daemon.config.reload", { scope: "daemon" }));
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: queryKeys.uiSurfaces("scope-b"),
  });
  unmount();
  queryClient.clear();
});
