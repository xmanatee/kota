import { AsyncLocalStorage } from "node:async_hooks";
import type { ToolCallExecutionOptions } from "./tool-runner-types.js";

const toolExecutionStorage = new AsyncLocalStorage<ToolCallExecutionOptions>();

/**
 * Return the authorization and execution context of the currently running
 * KOTA-hosted tool call. Nested hosted loops inherit this context so they do
 * not become a second, weaker authorization boundary.
 */
export function getCurrentToolCallExecutionOptions():
  | ToolCallExecutionOptions
  | undefined {
  return toolExecutionStorage.getStore();
}

export function withToolCallExecutionOptions<T>(
  options: ToolCallExecutionOptions,
  run: () => T,
): T {
  return toolExecutionStorage.run(options, run);
}
