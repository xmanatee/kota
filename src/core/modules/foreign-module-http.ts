/**
 * HTTP transport for the KOTA External Module Protocol.
 *
 * Connects to an already-running HTTP server that speaks KEMP over POST
 * requests. Each outbound message is sent as a JSON POST body; the server
 * replies with the corresponding inbound message as a JSON body.
 *
 * The protocol envelope and message types are identical to the stdio
 * transport — only the framing mechanism differs.
 */

import { OUTBOUND_HTTP_PROFILES, outboundHttp } from "#core/outbound-http/index.js";
import type { HttpForeignModuleConfig, KempInbound, KempOutbound, KempTransport } from "./foreign-module.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

function resolveToken(bearerToken: string | { env: string } | undefined): string | undefined {
  if (bearerToken === undefined) return undefined;
  if (typeof bearerToken === "string") return bearerToken;
  return process.env[bearerToken.env];
}

export class HttpTransport implements KempTransport {
  private closed = false;
  private msgQueue: KempInbound[] = [];
  private waiters: Array<(msg: KempInbound | null) => void> = [];
  private label: string;

  constructor(private config: HttpForeignModuleConfig) {
    this.label = `[foreign:http:${config.url}]`;
  }

  async send(msg: KempOutbound): Promise<void> {
    if (this.closed) throw new Error("Transport closed");

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = resolveToken(this.config.bearerToken);
    if (token) headers.Authorization = `Bearer ${token}`;

    let response: Response;
    try {
      ({ response } = await outboundHttp.request({
        profile: OUTBOUND_HTTP_PROFILES.configuredProvider([this.config.url]),
        operation: "foreign-module.kemp.send",
        url: this.config.url,
        method: "POST",
        headers,
        body: JSON.stringify(msg),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(`${this.label} HTTP request failed: ${message}`, "error");
      this.closed = true;
      for (const waiter of this.waiters) waiter(null);
      this.waiters = [];
      throw err;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${this.config.url}`);
    }

    const text = (await response.text()).trim();
    if (!text) return;

    let inbound: KempInbound;
    try {
      inbound = JSON.parse(text) as KempInbound;
    } catch {
      printTerminalDiagnostic(`${this.label} Malformed response: ${text}`, "warn");
      return;
    }

    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(inbound);
    } else {
      this.msgQueue.push(inbound);
    }
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
    for (const waiter of this.waiters) waiter(null);
    this.waiters = [];
  }
}
