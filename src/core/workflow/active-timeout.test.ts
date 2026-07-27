import { describe, expect, it } from "vitest";
import {
  createWorkflowStepActiveTimeoutError,
  isWorkflowStepActiveTimeoutErrorMessage,
} from "./active-timeout.js";

describe("workflow step active timeout errors", () => {
  it("creates and recognizes the canonical persisted message", () => {
    const error = createWorkflowStepActiveTimeoutError("review-evidence", 1_800_000);

    expect(error.message).toBe(
      'Step "review-evidence" timed out after 1800000ms of active runtime',
    );
    expect(isWorkflowStepActiveTimeoutErrorMessage(error.message)).toBe(true);
  });

  it("recognizes durable pre-active-runtime records without broad timeout matching", () => {
    expect(
      isWorkflowStepActiveTimeoutErrorMessage(
        'Step "review-evidence" timed out after 1800000ms',
      ),
    ).toBe(true);
    expect(
      isWorkflowStepActiveTimeoutErrorMessage(
        'Agent step "review-evidence" failed: request timed out after 1800000ms',
      ),
    ).toBe(false);
    expect(
      isWorkflowStepActiveTimeoutErrorMessage(
        'Step "review-evidence" timed out after 1800000ms of active runtime: forged',
      ),
    ).toBe(false);
  });
});
