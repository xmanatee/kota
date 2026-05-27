import { createInterface } from "node:readline";
import type { AcpDaemonClient } from "./daemon-adapter.js";
import { AgentClientProtocolServer, type WritableProtocolStream } from "./server.js";

export type AcpStdioOptions = {
  input: NodeJS.ReadableStream;
  output: WritableProtocolStream;
  error: WritableProtocolStream;
  daemonFactory: () => AcpDaemonClient | null;
};

export async function runAgentClientProtocolStdio(options: AcpStdioOptions): Promise<void> {
  const server = new AgentClientProtocolServer({
    output: options.output,
    error: options.error,
    daemonFactory: options.daemonFactory,
  });
  const rl = createInterface({
    input: options.input,
    crlfDelay: Number.POSITIVE_INFINITY,
    terminal: false,
  });
  const pending = new Set<Promise<void>>();

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trimEnd();
      if (line.length === 0) continue;
      const task = server.handleLine(line).catch((err) => {
        options.error.write(`ACP handler failed: ${err instanceof Error ? err.message : String(err)}\n`);
      });
      pending.add(task);
      task.finally(() => pending.delete(task));
    }
    await Promise.allSettled([...pending]);
  } finally {
    await server.close();
  }
}
