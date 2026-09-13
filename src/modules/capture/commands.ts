import { CAPTURE_TARGET_ORDER } from "./capture-types.js";
import type { CaptureClient, CaptureTarget } from "./client.js";
import { renderCaptureReplyPlain } from "./render.js";

// Channels supply the selected scope client and parsed body. Preserve its content;
// transport errors propagate to the channel's existing error handling.
export async function captureCommandReply(
  capture: CaptureClient,
  body: string,
  target?: CaptureTarget,
): Promise<string> {
  if (!body.trim()) {
    return renderCaptureReplyPlain({
      ok: false,
      reason: "ambiguous",
      suggestions: CAPTURE_TARGET_ORDER,
    });
  }
  return renderCaptureReplyPlain(
    await capture.capture(body, target === undefined ? undefined : { target }),
  );
}
