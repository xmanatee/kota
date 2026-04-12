/**
 * KOTA External Module Protocol (KEMP)
 *
 * A transport-agnostic JSON message protocol for loading modules implemented
 * in languages other than TypeScript. The protocol is the same regardless of
 * whether the transport is stdio, a Unix socket, or HTTP.
 *
 * ## Message format
 *
 * Messages are newline-delimited JSON objects (NDJSON). Each message has a
 * `type` field identifying its kind, and an optional `id` field correlating
 * requests with responses.
 *
 * ## Lifecycle
 *
 * 1. KOTA spawns or connects to the external process.
 * 2. KOTA sends `init` with runtime context.
 * 3. Module responds with `manifest` declaring its name, version, and tools.
 * 4. KOTA registers the declared tools; the module is now live.
 * 5. When a tool is invoked, KOTA sends `invoke`; module replies with `result`.
 * 6. On shutdown, KOTA sends `shutdown`; module may reply with `shutdown_ack`.
 *
 * ## Transport contract
 *
 * Implementations must guarantee:
 * - Messages are received in the order sent.
 * - Each message is a single line of JSON terminated by `\n`.
 * - The `id` of a `result` or `error` response matches the `id` of the
 *   triggering `invoke`.
 */

import type Anthropic from "@anthropic-ai/sdk";

// ─── Outbound (KOTA → Module) ────────────────────────────────────────────────

/** Sent once after connection is established. */
export type KempInit = {
  id: string;
  type: "init";
  /** Working directory of the KOTA process. */
  cwd: string;
  /** Config section for this module from KOTA's config file. */
  config?: Record<string, unknown>;
};

/** Invoke a tool previously declared in the manifest. */
export type KempInvoke = {
  id: string;
  type: "invoke";
  /** Tool name as declared in the manifest. */
  name: string;
  /** Tool input matching the declared input_schema. */
  input: Record<string, unknown>;
};

/** Sent when KOTA is shutting down or reloading this module. */
export type KempShutdown = {
  id: string;
  type: "shutdown";
};

/** Optional health check. Module should reply with `pong` using the same `id`. */
export type KempPing = {
  id: string;
  type: "ping";
};

/**
 * Request the module's runtime health state. Module should reply with
 * `health_status` using the same `id`. Modules that do not respond within
 * the timeout are assumed healthy.
 */
export type KempHealthCheck = {
  id: string;
  type: "health_check";
};

export type KempOutbound = KempInit | KempInvoke | KempShutdown | KempPing | KempHealthCheck;

// ─── Inbound (Module → KOTA) ─────────────────────────────────────────────────

/** Sent in response to `init`. Declares the module's identity and tools. */
export type KempManifest = {
  id: string;
  type: "manifest";
  name: string;
  version?: string;
  description?: string;
  /** Tools provided by this module. Same schema as Anthropic.Tool. */
  tools: Array<{
    name: string;
    description: string;
    input_schema: Anthropic.Tool["input_schema"];
  }>;
};

/** Sent in response to `invoke`. */
export type KempResult = {
  id: string;
  type: "result";
  /** Human-readable content — used as tool result text. */
  content: string;
  /** True when the tool call failed and content describes the error. */
  is_error?: boolean;
};

/** Acknowledgement of `shutdown`. Optional but recommended. */
export type KempShutdownAck = {
  id: string;
  type: "shutdown_ack";
};

/** Response to `ping`. Echo the same `id`. */
export type KempPong = {
  id: string;
  type: "pong";
};

/** Response to `health_check`. Reports the module's runtime health state. */
export type KempHealthStatus = {
  id: string;
  type: "health_status";
  status: "healthy" | "degraded" | "unhealthy";
  message?: string;
};

/** Sent when the module encounters a protocol or runtime error. */
export type KempError = {
  id?: string;
  type: "error";
  message: string;
};

/** Informational log message from the module. */
export type KempLog = {
  type: "log";
  level: "debug" | "info" | "warn" | "error";
  message: string;
};

export type KempInbound = KempManifest | KempResult | KempShutdownAck | KempError | KempLog | KempPong | KempHealthStatus;
export type KempMessage = KempOutbound | KempInbound;

// ─── Transport abstraction ───────────────────────────────────────────────────

/**
 * Transport interface — decouple the protocol from the wire.
 *
 * Implementations: `StdioTransport` (subprocess stdin/stdout).
 * Future: `UnixSocketTransport`, `HttpTransport`.
 */
export type KempTransport = {
  /** Send a message to the remote module. */
  send(msg: KempOutbound): Promise<void>;
  /**
   * Iterate over messages received from the remote module.
   * The generator should complete when the transport is closed.
   */
  receive(): AsyncGenerator<KempInbound>;
  /** Close the transport and release resources. */
  close(): Promise<void>;
};

// ─── Config ──────────────────────────────────────────────────────────────────

/** Stdio transport — spawns a subprocess and communicates over stdin/stdout. */
export type StdioForeignModuleConfig = {
  transport: "stdio";
  /** Executable to run (e.g. "python3", "/usr/bin/ruby"). */
  command: string;
  /** Arguments passed to the executable. */
  args?: string[];
  /** Additional environment variables for the subprocess. */
  env?: Record<string, string>;
  /**
   * Working directory for the subprocess.
   * Relative paths are resolved from the KOTA project root.
   * Defaults to the KOTA project root.
   */
  cwd?: string;
  /**
   * Maximum number of automatic restart attempts after an unexpected exit.
   * Set to 0 to disable restart. Default: 3.
   */
  maxRestarts?: number;
  /**
   * Milliseconds to wait for a `pong` response before declaring the subprocess
   * hung and triggering a restart. Default: 5000. Set to 0 to disable pings.
   */
  pingTimeoutMs?: number;
  /**
   * How often (ms) to send a health-check ping. Default: 30000.
   * Set to 0 to disable periodic pings.
   */
  pingIntervalMs?: number;
  /**
   * Base milliseconds for exponential restart backoff. Default: 2000.
   */
  restartBackoffBaseMs?: number;
};

/** HTTP transport — connects to an already-running HTTP server that speaks KEMP. */
export type HttpForeignModuleConfig = {
  transport: "http";
  /** Base URL of the KEMP HTTP server (e.g. "http://localhost:8765"). */
  url: string;
  /**
   * Optional bearer token sent as `Authorization: Bearer <token>` on every request.
   * Supply a string literal or `{ env: "ENV_VAR_NAME" }` to read from an environment variable.
   * The token is never logged.
   */
  bearerToken?: string | { env: string };
};

/** Configuration for a single foreign-language module entry. */
export type ForeignModuleConfig = StdioForeignModuleConfig | HttpForeignModuleConfig;
