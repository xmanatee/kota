export function throwIfToolRunnerAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const { reason } = signal;
  throw reason instanceof Error ? reason : new Error("Tool execution aborted");
}
