const PROCESS_ABORT_SIGNALS = ["SIGINT", "SIGTERM"] as const;

type ProcessAbortSignal = (typeof PROCESS_ABORT_SIGNALS)[number];

type ProcessSignalSource = {
  once(signal: ProcessAbortSignal, listener: () => void): void;
  off(signal: ProcessAbortSignal, listener: () => void): void;
};

export class ProcessSignalAbortError extends Error {
  readonly exitCode: number;

  constructor(readonly signal: ProcessAbortSignal) {
    super(`Process received ${signal}`);
    this.name = "AbortError";
    this.exitCode = signal === "SIGINT" ? 130 : 143;
  }
}

export async function withProcessSignalAbort<T>(
  operation: (abortController: AbortController) => Promise<T>,
  signalSource: ProcessSignalSource = process,
): Promise<T> {
  const abortController = new AbortController();
  const listeners = PROCESS_ABORT_SIGNALS.map((signal) => {
    const listener = (): void => {
      abortController.abort(new ProcessSignalAbortError(signal));
    };
    signalSource.once(signal, listener);
    return { signal, listener };
  });

  try {
    return await operation(abortController);
  } finally {
    for (const { signal, listener } of listeners) {
      signalSource.off(signal, listener);
    }
  }
}
