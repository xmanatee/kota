/**
 * Slack Web API client and transport for the slack-channel module.
 *
 * Uses Node built-in fetch for HTTP and the native WebSocket class for
 * Socket Mode. No external dependencies beyond the KOTA core.
 */

import type { AgentEvent, Transport } from "#core/loop/transport.js";

export const SLACK_API = "https://slack.com/api";
export const MAX_TEXT_LENGTH = 3000;
export const ERROR_BACKOFF_MS = 5_000;
export const RECONNECT_DELAY_MS = 3_000;

// --- Slack API types (minimal subset) ---

export type SlackUser = { id: string; name: string; real_name?: string };

export type SlackMessage = {
  ts: string;
  channel: string;
  text?: string;
};

export type SlackAction = {
  action_id: string;
  value?: string;
};

// Payload received over Socket Mode WebSocket
export type SocketPayload =
  | { type: "hello"; num_connections: number }
  | { type: "disconnect"; reason?: string }
  | { envelope_id: string; type: "events_api"; payload: SlackEventsApiPayload }
  | { envelope_id: string; type: "interactive"; payload: string | SlackInteractivePayload };

export type SlackEventsApiPayload = {
  team_id?: string;
  event_id?: string;
  event_time?: number;
  event: SlackEvent;
};

export type SlackMessageEvent = {
  type: "message";
  ts?: string;
  event_ts?: string;
  text?: string;
  user?: string;
  channel?: string;
  channel_type?: string;
  subtype?: string;
  bot_id?: string;
};

export type SlackEvent = SlackMessageEvent | { type: string; [key: string]: unknown };

export type SlackInteractivePayload = {
  type: "block_actions";
  actions: SlackAction[];
  user: { id: string; name: string };
  channel: { id: string };
  message: { ts: string };
};

// --- Slack Web API client ---

type SlackApiResponse<T> = { ok: true } & T | { ok: false; error: string };

export async function callSlackApi<T = Record<string, unknown>>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${SLACK_API}/${method}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error(`Slack API ${method}: network error: ${(err as Error).message}`);
  }
  let data: SlackApiResponse<T>;
  try {
    data = (await res.json()) as SlackApiResponse<T>;
  } catch {
    throw new Error(`Slack API ${method}: non-JSON response (HTTP ${res.status})`);
  }
  if (!data.ok) throw new Error(`Slack API ${method}: ${data.error}`);
  return data as T;
}

/** Open a Socket Mode WebSocket URL using the App-Level Token. */
export async function openSocketModeUrl(appToken: string): Promise<string> {
  const result = await callSlackApi<{ url: string }>(appToken, "apps.connections.open");
  return result.url;
}

/** Split text into chunks that fit Slack's message limits. */
export function splitText(text: string, maxLen = MAX_TEXT_LENGTH): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  return chunks;
}

// --- SlackTransport ---

/**
 * Transport that buffers agent text output and flushes it as one or more
 * Slack messages to the user's DM channel.
 */
export class SlackTransport implements Transport {
  private buffer = "";

  constructor(
    private botToken: string,
    private channelId: string,
  ) {}

  emit(event: AgentEvent): void {
    if (event.type === "text") {
      this.buffer += event.content;
    }
  }

  async flush(): Promise<void> {
    const text = this.buffer.trim();
    this.buffer = "";
    if (!text) return;
    const chunks = splitText(text);
    for (const chunk of chunks) {
      await callSlackApi(this.botToken, "chat.postMessage", {
        channel: this.channelId,
        text: chunk,
      });
    }
  }

  getBuffer(): string {
    return this.buffer;
  }
}
