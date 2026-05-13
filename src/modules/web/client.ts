/**
 * Web client contracts.
 *
 * The web module owns the `web` KotaClient namespace end-to-end: the boot
 * options, the discriminated start-result envelope, and the `WebClient`
 * interface itself. The aggregate `KotaClient` interface in
 * `src/core/server/kota-client.ts` composes this contract by importing
 * `WebClient` from this module instead of declaring the shapes inline.
 *
 * Both the local-side handler (`localClient(ctx)` in `index.ts`) and the
 * daemon-side handler (`daemonClient(_link)` in `index.ts`) realize
 * `WebClient`; the `kota serve` CLI consumes them through `ctx.client.web`.
 * The daemon-side handler is intentionally a stub-only constant refusal:
 * the underlying capability is a long-running HTTP API server with SSE
 * streaming and the embedded web UI, which the daemon cannot host on the
 * operator's behalf.
 */

/**
 * Options accepted by `web.start`.
 *
 * `port`, `model`, `verbose`, and `noAuth` map directly to the existing
 * `kota serve` flags. `defaultAutonomyMode` and `webUiBuilt` are resolved
 * by the local handler from the operator's environment and aren't exposed
 * on the namespace contract.
 */
export type WebStartOptions = {
  port: number;
  model?: string;
  verbose?: boolean;
  noAuth?: boolean;
};

/**
 * Result of `web.start`.
 *
 * The local handler resolves once the HTTP listener is ready to accept
 * requests. `daemon_required` surfaces from the daemon-side handler because
 * the daemon cannot start a fresh `kota serve` process in another address
 * space — running `kota serve` with a daemon already up is ambiguous, so the
 * contract refuses uniformly and the CLI maps that to a clear "stop the
 * daemon first" hint.
 */
export type WebStartResult =
  | { ok: true }
  | { ok: false; reason: "daemon_required" }
  | { ok: false; reason: "missing_api_key" };

export interface WebClient {
  start(options: WebStartOptions): Promise<WebStartResult>;
}
