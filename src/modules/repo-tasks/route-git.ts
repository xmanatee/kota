import { line, span } from "#modules/rendering/primitives.js";
import { printToStderr } from "#modules/rendering/transport.js";

export function logGitStageFailure(action: string, message: string): void {
  printToStderr(line(span(`[kota] Task route ${action} failed to stage changes: ${message}`, "error")));
}
