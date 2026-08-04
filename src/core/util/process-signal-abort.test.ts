import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  ProcessSignalAbortError,
  withProcessSignalAbort,
} from "./process-signal-abort.js";

describe("withProcessSignalAbort", () => {
  it("aborts the operation on SIGTERM and removes both listeners", async () => {
    const signals = new EventEmitter();
    const run = withProcessSignalAbort(
      (abortController) =>
        new Promise((_resolve, reject) => {
          abortController.signal.addEventListener(
            "abort",
            () => reject(abortController.signal.reason),
            { once: true },
          );
        }),
      signals,
    );

    signals.emit("SIGTERM");

    await expect(run).rejects.toMatchObject({
      name: "AbortError",
      signal: "SIGTERM",
      exitCode: 143,
    });
    expect(signals.listenerCount("SIGINT")).toBe(0);
    expect(signals.listenerCount("SIGTERM")).toBe(0);
  });

  it("maps SIGINT to the conventional exit code", () => {
    expect(new ProcessSignalAbortError("SIGINT").exitCode).toBe(130);
  });
});
