import { type ActiveClock, hostActiveClock } from "./host-suspension.js";

const TICK_MS = 1_000;
const SUSPENSION_GAP_MS = 5_000;

export type ActiveTimeoutSnapshot = {
  activeElapsedMs: number;
  suspendedMs: number;
};

export type ActiveTimingMetadata = {
  activeDurationMs?: number;
  hostSuspendedMs?: number;
};

export type ActiveTimeout = {
  expired: Promise<Error>;
  reset: () => void;
  snapshot: () => ActiveTimeoutSnapshot;
  dispose: () => void;
};

export function createWorkflowStepActiveTimeoutError(
  stepId: string,
  timeoutMs: number,
): Error {
  return new Error(
    `Step "${stepId}" timed out after ${timeoutMs}ms of active runtime`,
  );
}

export function rejectWhenActiveTimeoutExpires(
  timeout: ActiveTimeout,
): Promise<never> {
  return timeout.expired.then((error) => {
    throw error;
  });
}

export function activeTimingMetadata(
  snapshot: ActiveTimeoutSnapshot | undefined,
): ActiveTimingMetadata {
  if (snapshot === undefined) return {};
  return {
    activeDurationMs: snapshot.activeElapsedMs,
    ...(snapshot.suspendedMs > 0 ? { hostSuspendedMs: snapshot.suspendedMs } : {}),
  };
}

export function createActiveTimeout(
  timeoutMs: number,
  createError: (activeElapsedMs: number) => Error,
  onTimeout: (error: Error) => void,
  clock: ActiveClock = hostActiveClock,
): ActiveTimeout {
  let activeElapsedMs = 0;
  let suspendedMs = 0;
  let lastTick = clock.observe();
  let expectedDelayMs = Math.min(TICK_MS, timeoutMs);
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveExpired: (error: Error) => void = () => {};

  const expired = new Promise<Error>((resolve) => {
    resolveExpired = resolve;
  });

  const update = () => {
    const now = clock.observe();
    const elapsedMs = Math.max(0, now.monotonicMs - lastTick.monotonicMs);
    const gapMs = Math.max(elapsedMs, now.wallMs - lastTick.wallMs);
    const suspension = gapMs > expectedDelayMs + SUSPENSION_GAP_MS
      ? clock.suspendedBetween(lastTick, now) : 0;
    // Linux's monotonic clock already excludes sleep; macOS libuv uses a
    // continuous clock. Avoid subtracting Linux suspension twice.
    activeElapsedMs += now.bootMs !== undefined ? elapsedMs : Math.max(0, elapsedMs - suspension);
    suspendedMs += suspension;
    lastTick = now;
  };

  const schedule = () => {
    expectedDelayMs = Math.min(TICK_MS, Math.max(1, timeoutMs - activeElapsedMs));
    timer = setTimeout(tick, expectedDelayMs);
  };

  const tick = () => {
    if (settled) return;
    update();
    if (activeElapsedMs < timeoutMs) {
      schedule();
      return;
    }
    settled = true;
    const error = createError(Math.round(activeElapsedMs));
    resolveExpired(error);
    onTimeout(error);
  };

  schedule();

  return {
    expired,
    reset: () => {
      if (settled) return;
      update();
      activeElapsedMs = 0;
      if (timer !== undefined) clearTimeout(timer);
      schedule();
    },
    snapshot: () => {
      if (!settled) update();
      return {
        activeElapsedMs: Math.round(activeElapsedMs),
        suspendedMs: Math.round(suspendedMs),
      };
    },
    dispose: () => {
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}
