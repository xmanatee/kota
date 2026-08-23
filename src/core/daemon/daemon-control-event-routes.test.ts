import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SSE_HEARTBEAT_INTERVAL_MS,
  startSseHeartbeat,
} from "./daemon-control-event-routes.js";

describe("daemon event stream heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps an idle SSE response live until the connection closes", () => {
    vi.useFakeTimers();
    const write = vi.fn();
    const stop = startSseHeartbeat({ write });

    vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS * 2);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith(": heartbeat\n\n");

    stop();
    vi.advanceTimersByTime(SSE_HEARTBEAT_INTERVAL_MS);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
