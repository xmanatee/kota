/**
 * Stdio transport for the KOTA External Module Protocol.
 *
 * Spawns a subprocess and communicates with it via newline-delimited JSON
 * over stdin (KOTA → module) and stdout (module → KOTA). Stderr from the
 * subprocess is forwarded to KOTA's stderr for debugging.
 */

import { type ChildProcess, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { KempInbound, KempOutbound, KempTransport, StdioForeignExtensionConfig } from "./foreign-extension.js";

export class StdioTransport implements KempTransport {
  private proc: ChildProcess;
  private closed = false;
  private msgQueue: KempInbound[] = [];
  private waiters: Array<(msg: KempInbound | null) => void> = [];
  private label: string;

  constructor(config: StdioForeignExtensionConfig, projectCwd: string) {
    const cwd = config.cwd
      ? config.cwd.startsWith("/") ? config.cwd : `${projectCwd}/${config.cwd}`
      : projectCwd;

    this.label = `[foreign:${config.command}]`;
    this.proc = spawn(config.command, config.args ?? [], {
      cwd,
      env: { ...process.env, ...config.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Forward stderr for debugging
    this.proc.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(`${this.label} ${chunk}`);
    });

    // Parse stdout as NDJSON
    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed) as KempInbound;
        const waiter = this.waiters.shift();
        if (waiter) {
          waiter(msg);
        } else {
          this.msgQueue.push(msg);
        }
      } catch {
        process.stderr.write(`${this.label} Malformed message: ${trimmed}\n`);
      }
    });

    rl.on("close", () => {
      this.closed = true;
      // Drain any pending waiters
      for (const waiter of this.waiters) waiter(null);
      this.waiters = [];
    });

    this.proc.on("error", (err) => {
      process.stderr.write(`${this.label} Process error: ${err.message}\n`);
      this.closed = true;
      for (const waiter of this.waiters) waiter(null);
      this.waiters = [];
    });
  }

  async send(msg: KempOutbound): Promise<void> {
    if (this.closed) throw new Error("Transport closed");
    return new Promise((resolve, reject) => {
      this.proc.stdin!.write(`${JSON.stringify(msg)}\n`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async *receive(): AsyncGenerator<KempInbound> {
    while (!this.closed || this.msgQueue.length > 0) {
      if (this.msgQueue.length > 0) {
        yield this.msgQueue.shift()!;
        continue;
      }
      const msg = await new Promise<KempInbound | null>((resolve) => {
        if (this.closed) { resolve(null); return; }
        this.waiters.push(resolve);
      });
      if (msg === null) break;
      yield msg;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.proc.stdin?.end();
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => { this.proc.kill(); resolve(); }, 3000);
      this.proc.once("exit", () => { clearTimeout(timeout); resolve(); });
    });
  }
}
