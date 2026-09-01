import { describe, expect, it } from "vitest";
import { queryResourceState } from "./resource-state";

describe("queryResourceState", () => {
  it("exposes an initially paused offline query as retryable offline state", () => {
    const state = queryResourceState(
      {
        data: undefined,
        error: null,
        isFetching: false,
        isPending: true,
      },
      () => false,
      false,
    );

    expect(state).toEqual({
      status: "offline",
      error: new Error("Daemon is offline."),
    });
  });

  it("preserves an empty presentation while cached data refetches", () => {
    const state = queryResourceState(
      {
        data: [] as readonly string[],
        error: null,
        isFetching: true,
        isPending: false,
      },
      (items) => items.length === 0,
      true,
    );

    expect(state).toEqual({ status: "empty" });
  });
});
