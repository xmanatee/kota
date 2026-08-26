import { TestScopeProvider } from "@/lib/scope-context";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import fixture from "../../../../conformance/ui-behavior-vectors.generated.json";
import {
  type UiSurface,
  parseUiSurfaceBundle,
} from "../../../../conformance/ui-surface.generated";
import { SharedUiSurface } from "./SharedUiSurface";

export const bundle = parseUiSurfaceBundle(fixture.operatorBundle);
const foundOperatorSurface = bundle.surfaces.find(
  (surface) => surface.surfaceId === "operator-control",
);
if (!foundOperatorSurface) throw new Error("missing operator-control fixture");
export const operatorSurface: UiSurface = foundOperatorSurface;

export function renderSurface(
  surface: UiSurface = operatorSurface,
  onNavigate = vi.fn(),
  liveLogEntries = {},
  onSessionSelect = vi.fn(),
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    onNavigate,
    onSessionSelect,
    ...render(
      <QueryClientProvider client={queryClient}>
        <TestScopeProvider scopeId={surface.scopeId}>
          <SharedUiSurface
            surface={surface}
            onNavigate={onNavigate}
            onSessionSelect={onSessionSelect}
            liveLogEntries={liveLogEntries}
          />
        </TestScopeProvider>
      </QueryClientProvider>,
    ),
  };
}
