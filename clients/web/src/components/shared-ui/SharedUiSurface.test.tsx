import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { bundle, renderSurface } from "./SharedUiSurface.test-utils";

describe("SharedUiSurface protocol coverage", () => {
  it("renders every generated node arm through the live React renderer", () => {
    const renderedKinds = new Set<string>();
    for (const surface of bundle.surfaces) {
      const { container, unmount } = renderSurface(surface);
      for (const element of container.querySelectorAll(
        '[data-node-kind]:not([data-node-kind="surface-actions"])',
      )) {
        const kind = element.getAttribute("data-node-kind");
        if (kind !== null) renderedKinds.add(kind);
      }
      unmount();
    }

    expect(renderedKinds).toEqual(
      new Set([
        "status-summary",
        "metrics",
        "text",
        "link",
        "tabs",
        "list",
        "detail",
        "table",
        "progress",
        "log",
        "log-stream",
        "form",
        "action-list",
        "navigation",
        "command",
        "empty",
        "error",
      ]),
    );
    renderSurface();
    expect(screen.getByText("workflow.trigger: ready")).toBeInTheDocument();
    expect(screen.getAllByText("read access").length).toBeGreaterThan(0);
    expect(screen.getByText(/Live from \/events/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open shared UI surface route/ }),
    ).toHaveAttribute("href", "/ui/surfaces");
  });

  it("renders every generated action operation, effect, readiness, and confirmation arm", () => {
    const { container } = renderSurface();
    const forms = Array.from(
      container.querySelectorAll("form[data-action-id]"),
    );
    const values = (attribute: string) =>
      new Set(forms.map((form) => form.getAttribute(attribute)));

    expect(values("data-operation-kind")).toEqual(
      new Set(["client-namespace", "daemon-route"]),
    );
    expect(values("data-effect")).toEqual(
      new Set(["external", "read", "write"]),
    );
    expect(values("data-readiness")).toEqual(
      new Set(["disabled", "needs-setup", "ready"]),
    );
    expect(values("data-confirmation")).toEqual(new Set(["none", "required"]));
  });
});
