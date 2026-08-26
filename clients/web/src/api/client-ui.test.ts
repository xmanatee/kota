import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("shared UI API client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetModules();
  });

  it("strictly loads the selected scope's shared UI bundle", async () => {
    const fixture = await import("../../../conformance/ui-behavior-vectors.generated.json");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture.default.operatorBundle),
    });

    const { api } = await import("./client");
    const result = await api.getUiSurfaces("scope one");

    expect(result.protocolVersion).toBe("ui.surface.v1");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/ui/surfaces?scopeId=scope%20one",
      expect.any(Object),
    );
  });

  it("executes the graph-bound action with its canonical scope", async () => {
    const fixture = await import("../../../conformance/ui-behavior-vectors.generated.json");
    const { parseUiSurfaceBundle } = await import(
      "../../../conformance/ui-surface.generated"
    );
    const bundle = parseUiSurfaceBundle(fixture.default.operatorBundle);
    const action = bundle.surfaces
      .find((surface) => surface.surfaceId === "operator-control")
      ?.actions.find((candidate) => candidate.actionId === "workflow.launch");
    if (!action) throw new Error("missing fixture action");
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, message: "Workflow queued." }),
    });

    const { api } = await import("./client");
    await expect(
      api.executeUiAction(action, { name: "builder" }),
    ).resolves.toEqual({
      ok: true,
      message: "Workflow queued.",
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/ui/actions/execute",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scopeId: action.scopeId,
          surfaceId: action.surfaceId,
          actionId: action.actionId,
          parameters: { name: "builder" },
        }),
        headers: expect.objectContaining({
          "X-Kota-Dashboard-Request": "1",
        }),
      }),
    );
  });
});
