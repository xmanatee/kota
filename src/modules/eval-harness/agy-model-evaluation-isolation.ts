import type {
  AgyModelEvaluationIsolationBackend,
} from "./agy-model-evaluation-types.js";
import type { EvalRunIsolationBackend } from "./client.js";

export function requireAgyModelEvaluationIsolation(
  backend: EvalRunIsolationBackend | undefined,
): AgyModelEvaluationIsolationBackend {
  if (backend?.kind !== "container") {
    throw new Error(
      "AGY model evaluation requires container isolation; host subprocess execution cannot run isolated verifier calibration.",
    );
  }
  if (backend.networkPolicy?.kind !== "provider-egress") {
    throw new Error(
      "AGY model evaluation requires a provider-egress container network so Antigravity can reach the candidate provider while executable verifiers remain offline.",
    );
  }
  if (backend.networkPolicy.provider !== "google") {
    throw new Error(
      `AGY model evaluation requires Google provider egress, got ${JSON.stringify(backend.networkPolicy.provider)}.`,
    );
  }
  return {
    kind: "container",
    executable: backend.executable,
    image: backend.image,
    kotaBinaryPath: backend.kotaBinaryPath,
    networkPolicy: {
      kind: "provider-egress",
      provider: "google",
      enforcement: backend.networkPolicy.enforcement,
    },
  };
}
