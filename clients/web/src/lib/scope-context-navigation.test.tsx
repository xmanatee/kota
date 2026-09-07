import { Sidebar } from "@/components/sidebar/Sidebar";
import { parseScopeHash } from "@/lib/scope-context";
import { TestScopeProvider } from "@/lib/scope-context.test-utils";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const noop = () => {};

describe("scope context parsing and single-scope rendering", () => {
  it("parses #s/<scopeId>/<sub> hashes", () => {
    expect(parseScopeHash("#s/alpha/run/r1")).toEqual({
      scopeId: "alpha",
      subRoute: "run/r1",
    });
    expect(parseScopeHash("#s/alpha")).toEqual({
      scopeId: "alpha",
      subRoute: "",
    });
    expect(parseScopeHash("#run/r1")).toEqual({
      scopeId: null,
      subRoute: "run/r1",
    });
    expect(parseScopeHash("")).toEqual({ scopeId: null, subRoute: "" });
  });

  it("hides the selector for a loaded single-directory registry", () => {
    render(
      <TestScopeProvider>
        <Sidebar
          collapsed={false}
          onToggle={noop}
          onNewChat={noop}
          connectionStatus="connected"
          darkMode={false}
          onToggleTheme={noop}
          uiResource={{ status: "empty" }}
          onUiRetry={noop}
          selectedSurfaceId={null}
          onSurfaceSelect={noop}
        />
      </TestScopeProvider>,
    );
    expect(screen.queryByLabelText(/active scope/i)).not.toBeInTheDocument();
  });
});
