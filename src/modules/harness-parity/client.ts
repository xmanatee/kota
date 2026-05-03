/**
 * Harness-parity namespace client contract.
 *
 * The harness-parity module owns its KotaClient namespace surface end-to-end:
 * this file declares the request/response types and the `HarnessParityClient`
 * interface that the `KotaClient` aggregate composes. Both the local-side
 * handler (`localClient(ctx)` in `index.ts`) and the daemon-side handler
 * (`daemonClient(link)` in `index.ts`) realize this contract; the `kota
 * harness-parity` CLI consumes it through `ctx.client.harnessParity`.
 */

/** A scenario shipped under `src/modules/harness-parity/scenarios/`. */
export type HarnessParityScenarioSummary = {
  id: string;
  description: string;
};

export type HarnessParityListResult = {
  scenarios: HarnessParityScenarioSummary[];
};

export type HarnessParityRunOptions = {
  /** Restrict to these scenario ids. Empty / omitted runs every scenario. */
  scenarios?: string[];
  /** Restrict to these harness names. Empty / omitted runs every registered harness. */
  harnesses?: string[];
  /** Model identifier passed verbatim to every harness. */
  model?: string;
  /** Upper turn bound for harnesses that iterate. */
  maxTurns?: number;
  /** Override the output directory for paired artifacts. */
  outDir?: string;
  /** Keep the materialized working directories for inspection. */
  keepWorkingDir?: boolean;
};

/** Per-harness-per-scenario summary surfaced by `harnessParity.run`. */
export type HarnessParityArtifactSummary = {
  scenarioId: string;
  harnessName: string;
  passed: boolean;
  isError: boolean;
  turns: number;
  changedFiles: string[];
  artifactDir: string;
};

/**
 * Result of `harnessParity.run`.
 *
 * Errors that surface before the harness loop runs (scenario load, missing
 * scenarios, missing harnesses, invalid `maxTurns`) get a typed reason so
 * the CLI maps each to its existing failure path. Success carries every
 * paired artifact summary plus the resolved `outBaseDir`.
 */
export type HarnessParityRunResult =
  | {
      ok: true;
      outBaseDir: string;
      artifacts: HarnessParityArtifactSummary[];
    }
  | {
      ok: false;
      reason:
        | "scenarios_load_error"
        | "no_scenarios"
        | "no_harnesses"
        | "invalid_max_turns";
      message: string;
    };

/**
 * Harness-parity operations.
 *
 * `list` enumerates the scenarios shipped under
 * `src/modules/harness-parity/scenarios/`. `run` materializes each scenario
 * across every requested harness and returns the resulting paired-artifact
 * summary; the artifacts themselves land on disk under `outBaseDir`.
 */
export interface HarnessParityClient {
  list(): Promise<HarnessParityListResult>;
  run(options?: HarnessParityRunOptions): Promise<HarnessParityRunResult>;
}
