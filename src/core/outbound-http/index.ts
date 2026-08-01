export { createDefaultOutboundHttpDispatcher } from "#core/outbound-http/dispatcher.js";
export {
  OUTBOUND_HTTP_POLICY_MATRIX,
  OUTBOUND_HTTP_PROFILES,
  outboundHttpPolicy,
} from "#core/outbound-http/profiles.js";
export {
  redactOutboundHttpHeaders,
  redactOutboundHttpText,
  redactOutboundHttpUrl,
} from "#core/outbound-http/redaction.js";
export { requireOutboundHttpSuccess } from "#core/outbound-http/status-error.js";
export {
  OutboundHttpTransport,
  type OutboundHttpTransportOptions,
} from "#core/outbound-http/transport.js";
export {
  OUTBOUND_HTTP_PROFILE_NAMES,
  type OutboundHttpAddressResolver,
  type OutboundHttpDispatcher,
  OutboundHttpError,
  type OutboundHttpFailure,
  type OutboundHttpMethod,
  type OutboundHttpProfile,
  type OutboundHttpProfileName,
  type OutboundHttpRequest,
  type OutboundHttpResponse,
  type OutboundHttpRetryDisposition,
  type OutboundHttpTelemetryEvent,
  type OutboundHttpTelemetrySink,
} from "#core/outbound-http/types.js";

export const outboundHttp = new OutboundHttpTransport();

import { OutboundHttpTransport } from "#core/outbound-http/transport.js";
