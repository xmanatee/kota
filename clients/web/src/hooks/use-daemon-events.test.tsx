import { queryKeys } from "@/api/queries";
import { TestProjectProvider } from "@/lib/project-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../../conformance/contract-fixture.json";
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

  close() {}

  emit(event: string, payload: unknown) {
    const message = new MessageEvent(event, { data: JSON.stringify(payload) });
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
        <TestProjectProvider projectId="scope-a">
          {children}
        </TestProjectProvider>
      </QueryClientProvider>
    );

    const fixtureBundle = parseUiSurfaceBundle(fixture.uiSurfaces.statusInbox);
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
        projectId: "scope-a",
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
        projectId: "scope-a",
        timestamp: "2026-08-02T18:30:00.000Z",
        message: "Builder run completed.",
      });
    });

    expect(result.current.liveLogEntries["daemon-events"]).toEqual([
      {
        timestamp: "2026-08-02T18:30:00.000Z",
        level: "info",
        source: "workflow.run.completed",
        message: "Builder run completed.",
      },
    ]);
  });
});
