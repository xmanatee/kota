import type {
  ChannelAdapter,
  ChannelDef,
  ChannelStartContext,
  ChannelStatus,
} from "#core/channels/channel.js";

/**
 * Start a single contributed channel: invoke the channel's `create`,
 * dispatch on the result status, push the resulting channel status onto
 * `channelStatuses`, and append a started adapter to `activeChannels`.
 *
 * Status text matches the wire format the operator UIs expect — keep it
 * byte-identical when modifying.
 */
export async function startChannel(
  def: ChannelDef,
  channelCtx: ChannelStartContext,
  channelStatuses: ChannelStatus[],
  activeChannels: ChannelAdapter[],
  log: (message: string) => void,
): Promise<void> {
  const base = { name: def.name, ...(def.description ? { description: def.description } : {}) };
  let result: ReturnType<typeof def.create>;
  try {
    result = def.create(channelCtx);
  } catch (err) {
    const error = (err as Error)?.message ?? String(err);
    channelStatuses.push({ ...base, status: "failed", error });
    log(`Channel failed during create: ${def.name}: ${error}`);
    return;
  }
  if (result.status === "started") {
    try {
      await result.adapter.start();
    } catch (err) {
      const error = (err as Error)?.message ?? String(err);
      channelStatuses.push({ ...base, status: "failed", error });
      log(`Channel failed during start: ${def.name}: ${error}`);
      return;
    }
    activeChannels.push(result.adapter);
    channelStatuses.push({ ...base, status: "started" });
    log(`Channel started: ${def.name}`);
    return;
  }
  if (result.status === "failed") {
    channelStatuses.push({ ...base, status: "failed", error: result.error });
    log(`Channel failed: ${def.name}: ${result.error}`);
    return;
  }
  channelStatuses.push({ ...base, status: result.status, reason: result.reason });
  log(`Channel ${result.status}: ${def.name}: ${result.reason}`);
}
