import { describe, expect, it } from "vitest";
import {
  buildDaemonConfigReloadFailureEvent,
  buildDaemonConfigReloadSuccessEvent,
} from "./daemon-config-reload-event.js";

describe("daemon config reload event payloads", () => {
  it("classifies full, module-scoped, and no-op successful reloads", () => {
    expect(buildDaemonConfigReloadSuccessEvent({
      changedModules: ["git", "github"],
      isFullReload: true,
      workflowCount: 8,
      timestamp: "2026-01-01T00:00:00.000Z",
    })).toMatchObject({
      outcome: "success",
      scope: "daemon",
      reloadKind: "full",
      fullReload: true,
      changedModules: ["git", "github"],
      workflowCount: 8,
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(buildDaemonConfigReloadSuccessEvent({
      changedModules: ["git"],
      isFullReload: false,
      workflowCount: 8,
      timestamp: "2026-01-01T00:00:01.000Z",
    }).reloadKind).toBe("module-scoped");

    expect(buildDaemonConfigReloadSuccessEvent({
      changedModules: [],
      isFullReload: false,
      workflowCount: 8,
      timestamp: "2026-01-01T00:00:02.000Z",
    }).reloadKind).toBe("noop");
  });

  it("builds sanitized failure events without raw error text", () => {
    const event = buildDaemonConfigReloadFailureEvent({
      errorClass: "Error",
      workflowCount: 3,
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    expect(event).toEqual({
      timestamp: "2026-01-01T00:00:00.000Z",
      scope: "daemon",
      outcome: "failure",
      reloadKind: "failed",
      fullReload: false,
      changedModules: [],
      workflowCount: 3,
      errorClass: "Error",
      errorMessage: "Config reload failed",
    });
  });
});
