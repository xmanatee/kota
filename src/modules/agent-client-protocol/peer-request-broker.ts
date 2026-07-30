import { AcpPromptCancelledError } from "./daemon-adapter.js";
import {
  AcpProtocolError,
  type JsonObject,
  type JsonRpcId,
  type JsonRpcIncoming,
  type JsonValue,
  makeJsonRpcRequest,
} from "./protocol.js";

type WritableProtocolStream = { write(chunk: string): boolean | void };

type PendingPeerRequest = {
  resolve(value: JsonValue | undefined): void;
  reject(error: Error): void;
  abort(): void;
};

const PEER_PERMISSION_TIMEOUT_MS = 120_000;

export class PeerRequestBroker {
  private readonly pending = new Map<JsonRpcId, PendingPeerRequest>();
  private nextId = 1;

  constructor(
    private readonly output: WritableProtocolStream,
    private readonly error: WritableProtocolStream,
  ) {}

  close(): void {
    for (const request of this.pending.values()) request.abort();
    this.pending.clear();
  }

  request(
    method: string,
    params: JsonObject,
    signal: AbortSignal,
    timeoutMs = PEER_PERMISSION_TIMEOUT_MS,
  ): Promise<JsonValue | undefined> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
        this.pending.delete(id);
      };
      const finish = (value: JsonValue | undefined): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const abort = (): void => fail(new AcpPromptCancelledError());
      const timeout = setTimeout(() => {
        fail(new AcpProtocolError(
          -32603,
          `ACP peer request timed out: ${method}`,
          { code: "peer_request_timeout", method },
        ));
      }, Math.min(timeoutMs, PEER_PERMISSION_TIMEOUT_MS));
      timeout.unref();
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) {
        abort();
        return;
      }
      this.pending.set(id, { resolve: finish, reject: fail, abort });
      this.output.write(`${JSON.stringify(makeJsonRpcRequest(id, method, params))}\n`);
    });
  }

  handleResponse(message: Extract<JsonRpcIncoming, { kind: "response" }>): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.error.write(
        `ACP peer response ignored: no pending request for id ${String(message.id)}\n`,
      );
      return;
    }
    if (message.error) {
      pending.reject(peerResponseError(message.error));
      return;
    }
    pending.resolve(message.result);
  }

  handleMalformed(
    message: Extract<JsonRpcIncoming, { kind: "malformed_response" }>,
  ): void {
    const pending = this.pending.get(message.id);
    if (!pending) {
      this.error.write(
        `ACP malformed peer response ignored: no pending request for id ${String(message.id)}: ${message.error.message}\n`,
      );
      return;
    }
    pending.reject(message.error);
  }
}

function peerResponseError(error: JsonObject): AcpProtocolError {
  const code = typeof error.code === "number" ? error.code : -32603;
  const message = typeof error.message === "string" && error.message.length > 0
    ? error.message
    : "ACP peer request failed";
  const data = isJsonData(error.data) ? error.data : { code: "peer_request_failed" };
  return new AcpProtocolError(code, message, data);
}

function isJsonData(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
