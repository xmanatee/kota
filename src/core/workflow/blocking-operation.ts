import { Worker } from "node:worker_threads";
import type { WorkflowStepProgressReporter } from "./step-idle-timeout.js";

export type WorkflowBlockingOperation<TInput, TOutput> = {
  moduleUrl: string;
  exportName: string;
  /** Type-only marker; operation descriptors contain no runtime payload. */
  readonly __types?: { input: TInput; output: TOutput };
};

export type WorkflowBlockingOperationRunner = {
  runBlocking: <TInput, TOutput>(
    operation: WorkflowBlockingOperation<TInput, TOutput>,
    input: TInput,
  ) => Promise<TOutput>;
};

export type WorkflowBlockingOperationContext = {
  signal: AbortSignal;
  reportProgress: (label?: string) => void;
};

export type WorkflowBlockingOperationHandler<TInput, TOutput> = (
  input: TInput,
  context: WorkflowBlockingOperationContext,
) => TOutput | Promise<TOutput>;

type BlockingWorkerPayload =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined
  | BlockingWorkerPayload[]
  | { [key: string]: BlockingWorkerPayload };

type BlockingWorkerData = {
  moduleUrl: string;
  exportName: string;
  input: BlockingWorkerPayload;
};

type SerializedBlockingOperationError = {
  name: string;
  message: string;
  stack?: string;
};

type BlockingWorkerMessage =
  | { type: "result"; output: BlockingWorkerPayload }
  | { type: "progress"; label?: string }
  | { type: "error"; error: SerializedBlockingOperationError };

export type WorkflowBlockingOperationRunOptions = {
  signal?: AbortSignal;
  reportProgress?: WorkflowStepProgressReporter;
};

export class WorkflowBlockingOperationError extends Error {
  constructor(
    readonly operation: string,
    message: string,
    options: { name?: string; stack?: string } = {},
  ) {
    super(`Blocking operation "${operation}" failed: ${message}`);
    this.name = options.name ?? "WorkflowBlockingOperationError";
    if (options.stack !== undefined) this.stack = options.stack;
  }
}

export function defineWorkflowBlockingOperation<TInput, TOutput>(
  moduleUrl: string,
  exportName: string,
): WorkflowBlockingOperation<TInput, TOutput> {
  const parsed = new URL(moduleUrl);
  if (parsed.protocol !== "file:") {
    throw new Error("Workflow blocking operations must use file: module URLs");
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
    throw new Error(`Invalid workflow blocking operation export "${exportName}"`);
  }
  return { moduleUrl: parsed.href, exportName };
}

function sourceWorkerBootstrap(workerEntryUrl: string): string {
  return (
    `import("tsx/esm/api").then(({ register }) => {` +
    `register(); return import(${JSON.stringify(workerEntryUrl)});` +
    `}).catch((error) => { queueMicrotask(() => { throw error; }); });`
  );
}

function createBlockingWorker(data: BlockingWorkerData): Worker {
  const workerEntry = new URL("./blocking-operation-worker.js", import.meta.url);
  if (import.meta.url.endsWith(".ts")) {
    return new Worker(sourceWorkerBootstrap(workerEntry.href), {
      eval: true,
      workerData: data,
    });
  }
  return new Worker(workerEntry, { workerData: data });
}

function abortedOperationError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const error = new Error("Blocking operation aborted");
  error.name = "AbortError";
  return error;
}

/**
 * Runs trusted, definition-owned synchronous or CPU-heavy work in an isolated
 * worker thread. The daemon retains lifecycle ownership while its control
 * server event loop remains free to answer health and workflow-control calls.
 */
export function runWorkflowBlockingOperation<TInput, TOutput>(
  operation: WorkflowBlockingOperation<TInput, TOutput>,
  input: TInput,
  options: WorkflowBlockingOperationRunOptions = {},
): Promise<TOutput> {
  if (options.signal?.aborted) {
    return Promise.reject(abortedOperationError(options.signal));
  }

  return new Promise<TOutput>((resolve, reject) => {
    const operationId = `${operation.moduleUrl}#${operation.exportName}`;
    let settled = false;
    let abortTermination: ReturnType<typeof setTimeout> | undefined;
    let worker: Worker;
    try {
      worker = createBlockingWorker({
        moduleUrl: operation.moduleUrl,
        exportName: operation.exportName,
        input: input as BlockingWorkerPayload,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const dispose = (): void => {
      options.signal?.removeEventListener("abort", onAbort);
      if (abortTermination !== undefined) clearTimeout(abortTermination);
    };
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      dispose();
      callback();
    };
    const onAbort = (): void => {
      if (settled) return;
      try {
        worker.postMessage({ type: "abort" });
      } catch {
        // A worker that has already exited is handled by its exit event.
      }
      const error = abortedOperationError(options.signal!);
      settle(() => reject(error));
      abortTermination = setTimeout(() => {
        void worker.terminate();
      }, 25);
      abortTermination.unref();
    };

    options.signal?.addEventListener("abort", onAbort, { once: true });
    worker.on("message", (message: BlockingWorkerMessage) => {
      if (settled) return;
      if (message.type === "progress") {
        options.reportProgress?.({
          kind: "code-heartbeat",
          ...(message.label !== undefined ? { label: message.label } : {}),
        });
        return;
      }
      if (message.type === "error") {
        settle(() => {
          reject(
            new WorkflowBlockingOperationError(
              operationId,
              message.error.message,
              {
                name: message.error.name,
                ...(message.error.stack !== undefined
                  ? { stack: message.error.stack }
                  : {}),
              },
            ),
          );
        });
        return;
      }
      settle(() => resolve(message.output as TOutput));
    });
    worker.on("error", (error) => {
      settle(() =>
        reject(
          new WorkflowBlockingOperationError(operationId, error.message, {
            name: error.name,
            ...(error.stack !== undefined ? { stack: error.stack } : {}),
          }),
        ),
      );
    });
    worker.on("exit", (code) => {
      if (settled) return;
      settle(() =>
        reject(
          new WorkflowBlockingOperationError(
            operationId,
            `worker exited before returning a result (code ${code})`,
          ),
        ),
      );
    });
  });
}
