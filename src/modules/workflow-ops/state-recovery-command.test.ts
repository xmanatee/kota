import { describe, expect, it } from "vitest";
import {
  resolveWorkflowStateRecoveryCliEntrypoint,
  workflowStateRecoveryListCommand,
  workflowStateRecoveryResolveCommand,
} from "./state-recovery-command.js";

describe("workflow state recovery command hints", () => {
  it("uses the source-mode CLI entrypoint for source-loaded checkouts", () => {
    expect(workflowStateRecoveryListCommand("source")).toBe(
      "pnpm dev workflow state-recovery list",
    );
    expect(workflowStateRecoveryResolveCommand("task-alpha", "source")).toBe(
      'pnpm dev workflow state-recovery resolve task-alpha --action <release|supersede> --reason "<reason>"',
    );
  });

  it("keeps the package CLI entrypoint for dist-backed installs", () => {
    expect(workflowStateRecoveryListCommand("package")).toBe(
      "pnpm kota workflow state-recovery list",
    );
    expect(workflowStateRecoveryResolveCommand("task-alpha", "package")).toBe(
      'pnpm kota workflow state-recovery resolve task-alpha --action <release|supersede> --reason "<reason>"',
    );
  });

  it("detects source versus package module URLs", () => {
    expect(
      resolveWorkflowStateRecoveryCliEntrypoint(
        "file:///repo/src/modules/workflow-ops/state-recovery-command.ts",
      ),
    ).toBe("source");
    expect(
      resolveWorkflowStateRecoveryCliEntrypoint(
        "file:///repo/dist/modules/workflow-ops/state-recovery-command.js",
      ),
    ).toBe("package");
  });
});
