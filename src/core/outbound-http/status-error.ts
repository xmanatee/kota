import { redactOutboundHttpText, redactOutboundHttpUrl } from "#core/outbound-http/redaction.js";
import { OutboundHttpError, type OutboundHttpFailure, type OutboundHttpResponse } from "#core/outbound-http/types.js";

export async function requireOutboundHttpSuccess(result: OutboundHttpResponse): Promise<OutboundHttpResponse> {
  if (result.response.ok) return result;
  const responseBody = redactOutboundHttpText((await result.response.clone().text()).slice(0, 4_096));
  const statusText = redactOutboundHttpText(result.response.statusText);
  const failure: OutboundHttpFailure = {
    code: "http-status",
    profile: result.profile,
    operation: result.operation,
    method: result.method,
    url: redactOutboundHttpUrl(result.url),
    retry: result.retry,
    status: result.response.status,
    statusText,
    responseBody,
  };
  throw new OutboundHttpError(`http-status: HTTP ${result.response.status} ${statusText} (${failure.url})`, failure);
}
