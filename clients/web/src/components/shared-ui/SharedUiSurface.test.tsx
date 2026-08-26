import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderSurface } from "./SharedUiSurface.test-utils";

describe("SharedUiSurface protocol coverage", () => {
  it("renders the operator surface's status, permissions, live source, and navigation", () => {
    renderSurface();
    expect(screen.getByText("workflow.trigger")).toBeInTheDocument();
    expect(screen.getAllByText("ready").length).toBeGreaterThan(0);
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
