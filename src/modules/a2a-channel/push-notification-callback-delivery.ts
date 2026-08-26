import type { ModuleLogger } from "#core/modules/module-types.js";
import type { OutboundHttpTransport } from "#core/outbound-http/index.js";
import { postWithRetry } from "#modules/notification/index.js";
import { redactedCallbackUrl } from "./push-notification-callback-url.js";
import {
  buildPushDeliveryHeaders,
  type PushDeliveryPayload,
} from "./push-notification-delivery.js";
import type { StoredPushNotificationConfig } from "./push-notification-storage.js";

export type PushCallbackDeliveryOptions = {
  log: ModuleLogger;
  http?: Pick<OutboundHttpTransport, "request">;
};

export async function deliverPushNotificationCallback(
  config: StoredPushNotificationConfig,
  update: PushDeliveryPayload,
  options: PushCallbackDeliveryOptions,
): Promise<void> {
  const logUrl = redactedCallbackUrl(config.url);
  await postWithRetry(
    config.url,
    JSON.stringify(update),
    options.log,
    {
      retries: 2,
      baseDelayMs: 500,
      headers: buildPushDeliveryHeaders(config),
      logUrl,
      http: options.http,
    },
  );
}
