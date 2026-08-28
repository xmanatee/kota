import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { UiSurface } from "../../../../conformance/ui-surface.generated";
import { operatorSurface } from "./SharedUiSurface.test-utils";
import { renderSurface } from "./SharedUiSurface.test-utils";

describe("SharedUiSurface protocol coverage", () => {
  it("renders the operator surface's status, live source, and navigation", () => {
    renderSurface();
    expect(screen.getByText("workflow.trigger")).toBeInTheDocument();
    expect(screen.getAllByText("ready").length).toBeGreaterThan(0);
    expect(screen.getByText(/Live from \/events/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open shared UI surface route/ }),
    ).toHaveAttribute("href", "/ui/surfaces");
  });

  it("filters any declared table by search and exact column values", () => {
    const surface: UiSurface = {
      ...operatorSurface,
      surfaceId: "tasks",
      extensionId: "repo-tasks.queue",
      title: "Tasks",
      nodes: [
        {
          kind: "table",
          title: "Tasks",
          searchable: true,
          columns: [
            { id: "name", label: "Task" },
            { id: "state", label: "Status", filterable: true },
          ],
          rows: [
            {
              id: "task-open",
              cells: [
                { columnId: "name", value: "Build task list" },
                { columnId: "state", value: "Open" },
              ],
            },
            {
              id: "task-blocked",
              cells: [
                { columnId: "name", value: "Repair provider" },
                { columnId: "state", value: "Blocked" },
              ],
            },
          ],
        },
      ],
      actions: [],
    };
    renderSurface(surface);

    fireEvent.change(screen.getByLabelText("Filter by Status"), {
      target: { value: "Blocked" },
    });
    const table = screen.getByRole("table", { name: "Tasks" });
    expect(
      within(table).queryByText("Build task list"),
    ).not.toBeInTheDocument();
    expect(within(table).getByText("Repair provider")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    fireEvent.change(screen.getByLabelText("Search Tasks"), {
      target: { value: "build" },
    });
    expect(within(table).getByText("Build task list")).toBeInTheDocument();
    expect(
      within(table).queryByText("Repair provider"),
    ).not.toBeInTheDocument();
  });
});
