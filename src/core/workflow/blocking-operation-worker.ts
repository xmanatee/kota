import { parentPort, workerData } from "node:worker_threads";
import type {
  WorkflowBlockingOperationContext,
  WorkflowBlockingOperationHandler,
} from "./blocking-operation.js";

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

type BlockingOperationModule = {
  [exportName: string]: WorkflowBlockingOperationHandler<
    BlockingWorkerPayload,
    BlockingWorkerPayload
  >;
};

function serializeError(error: Error): {
  name: string;
  message: string;
  stack?: string;
} {
  return {
    name: error.name,
    message: error.message,
    ...(error.stack !== undefined ? { stack: error.stack } : {}),
  };
}

async function main(): Promise<void> {
  if (parentPort === null) throw new Error("Blocking operation worker requires a parent port");
  const port = parentPort;
  const data = workerData as BlockingWorkerData;
  const abortController = new AbortController();
  port.on("message", (message: { type?: string }) => {
    if (message.type === "abort") abortController.abort();
  });

  try {
    const loaded = (await import(data.moduleUrl)) as BlockingOperationModule;
    const operation = loaded[data.exportName];
    if (typeof operation !== "function") {
      throw new Error(
        `Module ${data.moduleUrl} does not export blocking operation ${data.exportName}`,
      );
    }
    const context: WorkflowBlockingOperationContext = {
      signal: abortController.signal,
      reportProgress: (label) =>
        port.postMessage({
          type: "progress",
          ...(label !== undefined ? { label } : {}),
        }),
    };
    const output = await operation(data.input, context);
    port.postMessage({ type: "result", output });
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    port.postMessage({ type: "error", error: serializeError(normalized) });
  } finally {
    port.close();
  }
}

void main();
