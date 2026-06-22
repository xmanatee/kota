import type { ModuleLogger } from "#core/modules/module-types.js";
import { postWithRetry } from "#modules/notification/index.js";
import { createCallbackDeliveryFetch } from "./push-notification-callback-fetch.js";
import type { CallbackAddressResolver } from "./push-notification-callback-hosts.js";
import { redactedCallbackUrl } from "./push-notification-callback-url.js";
import {
  buildPushDeliveryHeaders,
  type PushDeliveryPayload,
} from "./push-notification-delivery.js";
import type { StoredPushNotificationConfig } from "./push-notification-storage.js";

export type PushCallbackDeliveryOptions = {
  log: ModuleLogger;
  fetchImpl: typeof fetch;
  callbackAddressResolver?: CallbackAddressResolver;
};

export async function deliverPushNotificationCallback(
  config: StoredPushNotificationConfig,
  update: PushDeliveryPayload,
  options: PushCallbackDeliveryOptions,
): Promise<void> {
  const logUrl = redactedCallbackUrl(config.url);
  let fetchImpl: typeof fetch;
  try {
    fetchImpl = await createCallbackDeliveryFetch(config.url, {
      fetchImpl: options.fetchImpl === fetch ? undefined : options.fetchImpl,
      resolver: options.callbackAddressResolver,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    options.log.warn(`POST to ${logUrl} blocked: ${message}`);
    return;
  }

  await postWithRetry(
    config.url,
    JSON.stringify(update),
    options.log,
    {
      retries: 2,
      baseDelayMs: 500,
      headers: buildPushDeliveryHeaders(config),
      logUrl,
      fetchImpl,
    },
  );
}
