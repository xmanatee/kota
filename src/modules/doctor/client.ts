/**
 * Doctor namespace client contract.
 *
 * The doctor module owns its KotaClient namespace surface end-to-end: this
 * file declares the request/response types and the `DoctorClient` interface
 * that the `KotaClient` aggregate composes. Both the local-side handler
 * (`localClient(ctx)` in `index.ts`) and the daemon-side handler
 * (`daemonClient(link)` in `index.ts`) realize this contract; the `kota
 * doctor` CLI consumes it through `ctx.client.doctor`.
 */

/** A single doctor health-check result. */
export type DoctorCheckResult = {
  label: string;
  status: "pass" | "warn" | "fail";
  detail?: string;
};

/** A single doctor auto-repair result. */
export type DoctorRepairResult = {
  item: string;
  action: "repaired" | "skipped" | "manual";
  detail?: string;
};

export type DoctorRunOptions = {
  skipConnectivity?: boolean;
  /**
   * Preset id to preflight (`claude` | `codex` | `gemini` | …). When set,
   * `kota doctor` checks the preset's auth contract and reports a `fail`
   * row naming missing env vars when the preset uses env auth. Defaults to
   * the active preset resolved through `--preset` / `$KOTA_PRESET` /
   * `config.defaultPreset` / shipped default.
   */
  preset?: string;
};

export type DoctorRunResult = {
  checks: DoctorCheckResult[];
};

export type DoctorFixResult = {
  repairs: DoctorRepairResult[];
};

/**
 * Doctor operations.
 *
 * `run` executes the pass/warn/fail health checks (provider connectivity
 * is opt-out via `skipConnectivity`); `fix` applies the safe automatic
 * repairs (stale control file, missing canonical directories, stray
 * runtime directories). Both operations work daemon-up and daemon-down
 * — the daemon-side handler runs against the daemon's own runtime view,
 * the local handler runs against the CLI process view.
 */
export interface DoctorClient {
  run(options?: DoctorRunOptions): Promise<DoctorRunResult>;
  fix(): Promise<DoctorFixResult>;
}
