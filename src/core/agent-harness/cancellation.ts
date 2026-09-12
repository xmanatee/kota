import type {
  AgentHarnessAbortQuarantine,
  AgentHarnessRunOptions,
  AgentHarnessWriter,
  KotaAgentMessage,
} from "./types.js";

type OperationOutcome<T> =
  | { type: "result"; value: T }
  | { type: "error"; error: Error };

export type AgentHarnessCancellationBoundary = {
  options: AgentHarnessRunOptions;
  writer: AgentHarnessWriter | undefined;
  assertActive: () => void;
  assertNativeQuarantineRegistered: () => void;
  closeOutput: () => void;
  retireSettledNativeAttempt: () => Promise<void>;
  waitForNativeQuarantine: () => Promise<void>;
  race: <T>(operation: () => Promise<T>) => Promise<T>;
  dispose: () => void;
};

function abortError(signal: AbortSignal, harnessName: string): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const detail = signal.reason === undefined ? "" : `: ${String(signal.reason)}`;
  return new Error(`Agent harness "${harnessName}" aborted${detail}`);
}

function quarantineFailure(harnessName: string, error: Error): Error {
  return new Error(
    `Agent harness "${harnessName}" failed to quarantine its native execution: ${error.message}`,
    { cause: error },
  );
}

export function createAgentHarnessCancellationBoundary(
  harnessName: string,
  options: AgentHarnessRunOptions,
  writer: AgentHarnessWriter | undefined,
  requireNativeQuarantine: boolean,
  checkpointSessionId?: (id: string) => void,
): AgentHarnessCancellationBoundary {
  const signal = options.abortController?.signal;
  const assertActive = (): void => {
    if (signal?.aborted) throw abortError(signal, harnessName);
  };
  assertActive();

  let acceptingOutput = true;
  const closeOutput = (): void => {
    acceptingOutput = false;
  };
  const guardedMessage = options.onMessage === undefined
    ? undefined
    : async (message: KotaAgentMessage): Promise<void> => {
        if (!acceptingOutput || signal?.aborted) return;
        await options.onMessage?.(message);
      };
  const guardedWriter = writer === undefined
    ? undefined
    : {
        write: (text: string) => {
          if (!acceptingOutput || signal?.aborted) return false;
          return writer.write(text);
        },
      };

  let resolveAbort: (error: Error) => void = () => {};
  const aborted = signal === undefined
    ? undefined
    : new Promise<Error>((resolve) => {
        resolveAbort = resolve;
      });
  let resolveRegistered: () => void = () => {};
  const registered = new Promise<void>((resolve) => {
    resolveRegistered = resolve;
  });
  let quarantineHandler: ((reason: Error) => void | Promise<void>) | undefined;
  let quarantine: Promise<void> | undefined;
  let registrationFailure: Error | undefined;
  const startQuarantine = (reason: Error): void => {
    if (quarantine !== undefined || quarantineHandler === undefined) return;
    try {
      quarantine = Promise.resolve(quarantineHandler(reason));
    } catch (error) {
      quarantine = Promise.reject(error);
    }
    // An execution result can win the race before quarantine rejects. The
    // runner still awaits this barrier before releasing conversation ownership.
    void quarantine.catch(() => {});
  };
  const waitForQuarantine = async (): Promise<void> => {
    if (registrationFailure !== undefined) throw registrationFailure;
    if (quarantine === undefined) return;
    try {
      await quarantine;
    } catch (error) {
      throw quarantineFailure(
        harnessName,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  };
  const abortQuarantine: AgentHarnessAbortQuarantine = {
    register: (handler) => {
      if (quarantineHandler !== undefined) {
        throw new Error(
          `Agent harness "${harnessName}" registered more than one native abort quarantine barrier.`,
        );
      }
      quarantineHandler = handler;
      resolveRegistered();
      if (signal?.aborted) startQuarantine(abortError(signal, harnessName));
    },
  };

  const onAbort = signal === undefined
    ? undefined
    : () => {
        closeOutput();
        const error = abortError(signal, harnessName);
        startQuarantine(error);
        resolveAbort(error);
      };
  if (signal !== undefined && onAbort !== undefined) {
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  }

  const effectiveOptions = {
    ...options,
    onSessionId: (id: string) => {
      // Durable identity follows adapter ownership, independently of caller output.
      checkpointSessionId?.(id);
      if (acceptingOutput && !signal?.aborted) options.onSessionId?.(id);
    },
    ...(guardedMessage !== undefined ? { onMessage: guardedMessage } : {}),
    ...(requireNativeQuarantine ? { abortQuarantine } : {}),
  };

  return {
    options: effectiveOptions,
    writer: guardedWriter,
    assertActive,
    assertNativeQuarantineRegistered: () => {
      if (!requireNativeQuarantine || quarantineHandler !== undefined) return;
      const error = new Error(
        `Agent harness "${harnessName}" launched a native execution without registering its abort quarantine barrier.`,
      );
      registrationFailure = error;
      options.abortController?.abort(error);
      throw error;
    },
    closeOutput,
    waitForNativeQuarantine: async () => {
      // Process settlement alone may leave provider-owned work running remotely.
      startQuarantine(new Error("Confirming settled native execution stopped"));
      await waitForQuarantine();
    },
    retireSettledNativeAttempt: async () => {
      startQuarantine(new Error("Retiring settled session recovery attempt"));
      await waitForQuarantine();
      assertActive();
      quarantineHandler = undefined;
      quarantine = undefined;
    },
    race: async <T>(operation: () => Promise<T>): Promise<T> => {
      assertActive();
      const operationOutcome: Promise<OperationOutcome<T>> = operation().then(
        (value) => ({ type: "result" as const, value }),
        (error) => ({
          type: "error" as const,
          error: error instanceof Error ? error : new Error(String(error)),
        }),
      );
      if (requireNativeQuarantine) {
        const registrationOutcome = await Promise.race([
          registered.then(() => ({ type: "registered" as const })),
          operationOutcome,
          ...(aborted === undefined
            ? []
            : [aborted.then((error) => ({ type: "aborted" as const, error }))]),
        ]);
        if (registrationOutcome.type === "result") return registrationOutcome.value;
        if (registrationOutcome.type === "error") throw registrationOutcome.error;
        if (registrationOutcome.type === "aborted") {
          await waitForQuarantine();
          throw registrationOutcome.error;
        }
      }

      if (aborted === undefined) {
        const outcome = await operationOutcome;
        if (outcome.type === "error") throw outcome.error;
        return outcome.value;
      }
      const outcome = await Promise.race([
        operationOutcome,
        aborted.then((error) => ({ type: "aborted" as const, error })),
      ]);
      if (outcome.type === "result") return outcome.value;
      if (outcome.type === "error") throw outcome.error;
      await waitForQuarantine();
      throw outcome.error;
    },
    dispose: () => {
      closeOutput();
      if (signal !== undefined && onAbort !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
