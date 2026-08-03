import { describe, expect, it } from "vitest";
import { createWorkflowStepActiveTimeoutError } from "./active-timeout.js";

describe("workflow step active timeout error", () => {
  it("creates the operator-facing message", () => {
    const error = createWorkflowStepActiveTimeoutError("review-evidence", 1_800_000);

    expect(error.message).toBe(
      'Step "review-evidence" timed out after 1800000ms of active runtime',
    );
  });
});
