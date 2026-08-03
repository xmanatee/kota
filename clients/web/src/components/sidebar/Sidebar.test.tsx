import { TestProjectProvider } from "@/lib/project-context";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import fixture from "../../../../conformance/contract-fixture.json";
import { parseUiSurfaceBundle } from "../../../../conformance/ui-surface.generated";
import { Sidebar } from "./Sidebar";

const bundle = parseUiSurfaceBundle(fixture.uiSurfaces.statusInbox);
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
    uiBundle: bundle,
    uiLoading: false,
    uiError: null,
    selectedSurfaceId: null,
    onSurfaceSelect: noop,
    ...overrides,
  };
  return render(
    <TestProjectProvider>
      <Sidebar {...props} />
    </TestProjectProvider>,
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

    expect(
      within(nav).getByRole("button", { name: /Status core\.status/ }),
    ).toHaveAttribute("data-surface-id", "status");
    expect(
      within(nav).getByRole("button", { name: /Operator Control/ }),
    ).toHaveAttribute("data-surface-id", "operator-control");
  });

  it("selects graph-declared surfaces", () => {
    const onSurfaceSelect = vi.fn();
    renderSidebar({ onSurfaceSelect });

    fireEvent.click(screen.getByRole("button", { name: /Inbox core\.inbox/ }));
    expect(onSurfaceSelect).toHaveBeenCalledWith("inbox");
  });

  it("renders loading and unavailable states without a fallback catalog", () => {
    const view = renderSidebar({
      uiBundle: undefined,
      uiLoading: true,
    });
    expect(
      screen.getByText("Loading shared operator surfaces"),
    ).toBeInTheDocument();

    view.rerender(
      <TestProjectProvider>
        <Sidebar
          collapsed={false}
          onToggle={noop}
          onNewChat={noop}
          connectionStatus="disconnected"
          darkMode={false}
          onToggleTheme={noop}
          uiBundle={undefined}
          uiLoading={false}
          uiError={new Error("daemon unavailable")}
          selectedSurfaceId={null}
          onSurfaceSelect={noop}
        />
      </TestProjectProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("daemon unavailable");
    expect(screen.queryByText("Overview")).not.toBeInTheDocument();
  });
});
