import { describe, expect, it } from "vitest";
import type {
  ModuleSetupStatusResponse,
} from "#modules/setup/client.js";
import { buildSetupUiSurface } from "./ui-surface.js";

const EMPTY_SUMMARY = {
  ready: 0,
  missing: 0,
  pending: 0,
  expired: 0,
  revoked: 0,
  unknown: 0,
  unavailable: 0,
};

function statusFor(
  visibility: ModuleSetupStatusResponse["visibility"],
): ModuleSetupStatusResponse {
  return {
    visibility,
    requirements: visibility === "hidden"
      ? []
      : [{
          moduleName: "model-clients",
          requirementId: "openrouter-api-key",
          kind: "config",
          title: "OpenRouter API key credential",
          required: true,
          scope: "project",
          sensitivity: "none",
          setup: { mode: "none" },
          state: "missing",
          reason: "api_key_missing",
          message: "Required credential is missing",
        }],
    summary: visibility === "hidden"
      ? EMPTY_SUMMARY
      : { ...EMPTY_SUMMARY, missing: 1 },
  };
}

describe("setup UI policy visibility", () => {
  it("renders visibility and withholds mutations outside full visibility", () => {
    const metadata = buildSetupUiSurface({
      scopeId: "p-kota-fixture-default",
      setup: { ok: true, value: statusFor("metadata") },
    });
    expect(metadata.actions.map((action) => action.actionId)).toEqual(["setup.list"]);
    const summary = metadata.nodes.find((node) => node.kind === "status-summary");
    expect(summary?.kind === "status-summary" ? summary.entries : []).toContainEqual(
      expect.objectContaining({ label: "visibility", value: "metadata" }),
    );

    const hidden = buildSetupUiSurface({
      scopeId: "p-kota-fixture-default",
      setup: { ok: true, value: statusFor("hidden") },
    });
    expect(hidden.actions.map((action) => action.actionId)).toEqual(["setup.list"]);
    const table = hidden.nodes.find((node) => node.kind === "table");
    expect(table?.kind === "table" ? table.rows[0]?.cells : []).toContainEqual(
      expect.objectContaining({
        columnId: "name",
        value: "Setup requirements hidden by scope policy",
      }),
    );
  });
});
