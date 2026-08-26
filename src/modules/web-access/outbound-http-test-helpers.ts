import { vi } from "vitest";
import { OutboundHttpTransport, outboundHttp } from "#core/outbound-http/index.js";
import { resolveOutboundAddresses, resolvePublicOutboundAddresses } from "#core/outbound-http/network-policy.js";

/** Routes module fixtures through the same transport seam as the Node dispatcher. */
export function installGlobalFetchTransportFixture(): void {
  const transport = new OutboundHttpTransport({
    resolveAddresses: resolveOutboundAddresses,
    dispatcher: async (url, init, context) => {
      if (context.profile === "public-untrusted") {
        await resolvePublicOutboundAddresses(url.hostname, resolveOutboundAddresses);
      }
      return globalThis.fetch(url.toString(), init);
    },
  });
  vi.spyOn(outboundHttp, "request").mockImplementation((request) => transport.request(request));
}
