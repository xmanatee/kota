import { TestScopeProvider } from "@/lib/scope-context.test-utils";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../conformance/ui-behavior-vectors.generated.json";
import { parseUiSurfaceBundle } from "../../../../conformance/ui-surface.generated";
import { Sidebar } from "./Sidebar";

const bundle = parseUiSurfaceBundle(fixture.operatorBundle);
const noop = () => {};

function renderSidebar(
  overrides: Partial<React.ComponentProps<typeof Sidebar>> = {},
) {
  const props: React.ComponentProps<typeof Sidebar> = {
    collapsed: false,
    onToggle: noop,
    onNewChat: noop,
    connectionStatus: "connected",
    darkMode: false,
    onToggleTheme: noop,
    uiResource: { status: "success", value: bundle },
    onUiRetry: noop,
    selectedSurfaceId: null,
    onSurfaceSelect: noop,
    ...overrides,
  };
  return render(
    <TestScopeProvider>
      <Sidebar {...props} />
    </TestScopeProvider>,
  );
}

describe("Sidebar shared UI navigation", () => {
  it("derives intents and surfaces only from the daemon bundle", () => {
    renderSidebar();

    const nav = screen.getByRole("navigation", {
      name: "Shared operator surfaces",
    });
    expect(
      within(nav)
        .getAllByRole("group")
        .map((group) => group.getAttribute("data-intent")),
    ).toEqual(["Status", "Inbox", "Work", "Setup"]);
    expect(screen.queryByText("Knowledge")).not.toBeInTheDocument();
    expect(screen.queryByText("Recall")).not.toBeInTheDocument();

    expect(within(nav).getByRole("button", { name: "Status" })).toHaveAttribute(
      "data-surface-id",
      "status",
    );
    expect(
      within(nav).getByRole("button", { name: /Operator Control/ }),
    ).toHaveAttribute("data-surface-id", "operator-control");
  });

  it("selects graph-declared surfaces", () => {
    const onSurfaceSelect = vi.fn();
    renderSidebar({ onSurfaceSelect });

    fireEvent.click(screen.getByRole("button", { name: "Inbox" }));
    expect(onSurfaceSelect).toHaveBeenCalledWith("inbox");
  });

  it("renders loading and unavailable states without a fallback catalog", () => {
    const onUiRetry = vi.fn();
    const view = renderSidebar({
      uiResource: { status: "loading" },
    });
    expect(
      screen.getByText("Loading shared operator surfaces"),
    ).toBeInTheDocument();

    view.rerender(
      <TestScopeProvider>
        <Sidebar
          collapsed={false}
          onToggle={noop}
          onNewChat={noop}
          connectionStatus="disconnected"
          darkMode={false}
          onToggleTheme={noop}
          uiResource={{
            status: "recoverable-failure",
            error: new Error("daemon unavailable"),
          }}
          onUiRetry={onUiRetry}
          selectedSurfaceId={null}
          onSurfaceSelect={noop}
        />
      </TestScopeProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("daemon unavailable");
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onUiRetry).toHaveBeenCalledOnce();
  });
});
