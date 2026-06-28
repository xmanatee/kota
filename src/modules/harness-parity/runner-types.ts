import type {
  AgentEffort,
  AgentHarness,
  AgentHarnessWriter,
  HarnessCapabilitySnapshot,
  KotaAgentMessage,
} from "#core/agent-harness/index.js";
import type { ContextRetrievalDiagnosticsMetadata } from "./context-retrieval-diagnostics.js";
import type { LoadedScenario } from "./scenario.js";
import type { HarnessParityTrajectoryDiagnosticsMetadata } from "./trajectory-diagnostics.js";

export type HarnessParityCallOptions = {
  /** Model identifier the harness should use (resolved from the active preset by the caller). */
  model: string;
  /** Neutral reasoning posture the harness should use. Defaults to xhigh. */
  effort?: AgentEffort;
  /** Optional system prompt to forward to the adapter. */
  systemPrompt?: string;
  /**
   * Upper turn bound for harnesses that iterate. Thin harness ignores this.
   * Applied verbatim to `AgentHarnessRunOptions.maxTurns`.
   */
  maxTurns?: number;
};

export type HarnessParityRunParams = {
  scenario: LoadedScenario;
  harness: AgentHarness;
  callOptions: HarnessParityCallOptions;
  /** Base artifact directory. The runner writes into `<outBaseDir>/<harness.name>/`. */
  outBaseDir: string;
  /** Keep the materialized working directory for post-mortem inspection. */
  keepWorkingDir?: boolean;
};

export type VerificationResult = {
  command: string;
  timeoutMs: number;
  passed: boolean;
  exitStatus: number | null;
  timedOut: boolean;
  output: string;
};

export type PreviewArtifactResult =
  | {
      sourcePath: string;
      artifactPath: string;
      preserved: true;
    }
  | {
      sourcePath: string;
      artifactPath: string;
      preserved: false;
      reason: "missing" | "not_file";
    };

export type HarnessParityArtifact = {
  scenarioId: string;
  harnessName: string;
  model: string;
  /**
   * Reasoning posture the harness actually ran under. Paired artifacts
   * show this alongside `harness` and `model` so an operator comparing
   * adapters can see which reasoning surface (if any) was engaged.
   */
  effort: AgentEffort;
  startedAt: string;
  durationMs: number;
  turns: number;
  isError: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  subtype?: string;
  sessionId?: string;
  verification: VerificationResult;
  /** Static adapter boundary and optional local readiness observed before the run. */
  capability: HarnessCapabilitySnapshot;
  /** Files changed under the working directory relative to the initial tree. */
  changedFiles: readonly string[];
  /** Declared operator preview artifacts copied after verification, if any. */
  previewArtifacts: readonly PreviewArtifactResult[];
  /** Where artifacts for this harness x scenario run landed. */
  artifactDir: string;
  /** Structured action/observation trajectory captured from `onMessage`. */
  trajectory: HarnessParityTrajectoryMetadata;
  /** Advisory process-quality diagnostics derived from structured trajectory frames. */
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
  /** Advisory diagnostics showing whether declared context targets were reached before edits. */
  contextRetrievalDiagnostics?: ContextRetrievalDiagnosticsMetadata;
  /** Original scenario execution mode. */
  stageMode: "single" | "staged";
  /** Ordered stage artifacts. Single-stage scenarios contain one `main` stage. */
  stages: readonly HarnessParityStageArtifact[];
  /** Compact per-stage status used by run-meta.json and parity.json. */
  stagedSummary: HarnessParityStagedSummary;
};

export type HarnessParityStageArtifact = {
  stageId: string;
  scenarioId: string;
  harnessName: string;
  model: string;
  effort: AgentEffort;
  startedAt: string;
  durationMs: number;
  turns: number;
  isError: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalCostUsd?: number;
  subtype?: string;
  sessionId?: string;
  verification: VerificationResult;
  capability: HarnessCapabilitySnapshot;
  changedFiles: readonly string[];
  previewArtifacts: readonly PreviewArtifactResult[];
  artifactDir: string;
  trajectory: HarnessParityTrajectoryMetadata;
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
  contextRetrievalDiagnostics?: ContextRetrievalDiagnosticsMetadata;
};

export type HarnessParityStageSummary = {
  stageId: string;
  verificationPassed: boolean;
  changedFiles: readonly string[];
  isError: boolean;
  turns: number;
  durationMs: number;
  artifactDir: string;
  previewArtifacts: readonly PreviewArtifactResult[];
  trajectory: HarnessParityTrajectoryMetadata;
  trajectoryDiagnostics: HarnessParityTrajectoryDiagnosticsMetadata;
  contextRetrievalDiagnostics?: ContextRetrievalDiagnosticsMetadata;
};

export type HarnessParityStagedSummary = {
  mode: "single" | "staged";
  passed: boolean;
  stageCount: number;
  stages: readonly HarnessParityStageSummary[];
};

export type CollectingWriter = AgentHarnessWriter & { collected(): string };

export type HarnessParityTrajectoryStatus = "supported" | "unsupported";

export type HarnessParityTrajectoryCounts = {
  frameCount: number;
  toolCallCount: number;
  toolResultCount: number;
  statusCount: number;
  resultCount: number;
  truncatedFrameCount: number;
};

type HarnessParityTrajectoryBaseMetadata = HarnessParityTrajectoryCounts & {
  status: HarnessParityTrajectoryStatus;
  emitsAgentMessageStream: boolean;
  artifactPath: string;
  summaryPath: string;
};

export type HarnessParitySupportedTrajectoryMetadata =
  HarnessParityTrajectoryBaseMetadata & {
    status: "supported";
    emitsAgentMessageStream: true;
  };

export type HarnessParityUnsupportedTrajectoryMetadata =
  HarnessParityTrajectoryBaseMetadata & {
    status: "unsupported";
    emitsAgentMessageStream: false;
    reason: string;
  };

export type HarnessParityTrajectoryMetadata =
  | HarnessParitySupportedTrajectoryMetadata
  | HarnessParityUnsupportedTrajectoryMetadata;

export type HarnessParityTrajectoryFrame = {
  index: number;
  type: KotaAgentMessage["type"];
  message: KotaAgentMessage;
  truncatedFields: string[];
  toolName?: string;
};

export type HarnessParityStageRunRecord = HarnessParityStageArtifact & {
  diff: string;
  runError: Error | null;
  streamedText: string;
};
