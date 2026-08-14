import type {
  ContainerNetworkPolicyRequest,
  ProviderEgressTaskSubprocessBoundaryRequest,
} from "./provider-egress.js";

export type SubprocessExecutorOptions = {
  /** Path to the `kota` binary (`./bin/kota.mjs` when running from the repo). */
  kotaBinaryPath: string;
  /**
   * Extra env vars to forward to the subprocess. The fixture's HOME is
   * deliberately pointed at the working directory so credential-driven side
   * effects cannot leak from the operator's real environment.
   */
  extraEnv?: Record<string, string>;
  /**
   * Active agent harness tool-control facts used to decide whether a
   * provider-egress container can honestly gate. KOTA-hosted tool loops route
   * task subprocesses through KOTA's filtered tool env; native CLI tool loops
   * own their subprocess env and therefore remain runnable but non-gating.
   */
  providerEgressTaskBoundary?: ProviderEgressTaskSubprocessBoundaryRequest;
  /** Abort the active workflow subprocess when its owning execution ends. */
  signal?: AbortSignal;
  /**
   * Optional isolation backend request. Host subprocess execution is the
   * default and is explicitly non-gating because it cannot enforce CPU or
   * memory limits. Container support is capability-detected before any run;
   * an unavailable backend produces a typed non-gating preflight result.
   */
  isolationBackend?: SubprocessIsolationBackend;
};

export type SubprocessIsolationBackend =
  | { kind: "host-subprocess" }
  | {
      kind: "container";
      /** Docker-compatible executable, for example `docker` or `podman`. */
      executable: string;
      /** Container image that contains Node and can run the KOTA CLI. */
      image: string;
      /**
       * Absolute path inside the container image to KOTA's `bin/kota.mjs`.
       * The image must preserve the package layout so `../dist` exists.
       */
      kotaBinaryPath: string;
      /**
       * Container network policy. Omitted means the strict offline default:
       * Docker receives `--network none` and no provider proxy env.
       */
      networkPolicy?: ContainerNetworkPolicyRequest;
    };

export type RunMetadataSnapshot = {
  id: string;
  status: string;
};

export type WorkflowRunMetadataSnapshot = RunMetadataSnapshot & {
  terminal: boolean;
};

export type ContainerEnvFile = {
  path: string;
  cleanup: () => void;
};

export type SubprocessChildSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
  cleanup?: () => void;
};

export type ContainerIsolationBackend = Extract<
  SubprocessIsolationBackend,
  { kind: "container" }
>;
