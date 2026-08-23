export { createDefaultOutboundHttpDispatcher } from "#core/outbound-http/dispatcher.js";
export {
  resolveOutboundAddresses,
  resolveOutboundHttpConnectionAddress,
  resolvePublicOutboundAddresses,
  validateOutboundHttpTarget,
} from "#core/outbound-http/network-policy.js";
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
  type OutboundHttpStreamingOptions,
  type OutboundHttpStreamingResponse,
  type OutboundHttpTelemetryEvent,
  type OutboundHttpTelemetrySink,
  type ResolvedOutboundAddress,
} from "#core/outbound-http/types.js";

export const outboundHttp = new OutboundHttpTransport();

import { OutboundHttpTransport } from "#core/outbound-http/transport.js";
