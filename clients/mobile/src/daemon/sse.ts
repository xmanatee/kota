import type { DaemonHttp } from "./http";
import { createSseDecoder, type SseFrame } from "./sse-parser";

export interface SseEvent {
	type: string;
	payload: Record<string, unknown>;
	timestamp?: string;
}
export interface EventSubscription {
	onEvent: (event: SseEvent) => void;
	onStatus: (connected: boolean) => void;
	onMalformed?: (raw: string, error: Error) => void;
}

export function decodeEventData(data: string): Record<string, unknown> {
	const value: unknown = JSON.parse(data);
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Daemon event data must be an object");
	}
	return value as Record<string, unknown>;
}

/** XHR is the React Native streaming port; namespace callers own event meaning. */
export function streamSse(
	http: DaemonHttp,
	path: string,
	callbacks: {
		onFrame: (frame: SseFrame) => void;
		onOpen?: () => void;
		onEnd: () => void;
		onError: (error: Error) => void;
	},
	body?: unknown,
): () => void {
	const xhr = new XMLHttpRequest();
	const decoder = createSseDecoder(callbacks.onFrame);
	let offset = 0;
	let settled = false;
	const fail = (error: Error) => {
		if (settled) return;
		settled = true;
		xhr.abort();
		callbacks.onError(error);
	};
	xhr.open(body === undefined ? "GET" : "POST", `${http.baseUrl}${path}`, true);
	xhr.setRequestHeader("Authorization", `Bearer ${http.token}`);
	xhr.setRequestHeader("Accept", "text/event-stream");
	if (body !== undefined)
		xhr.setRequestHeader("Content-Type", "application/json");
	xhr.onreadystatechange = () => {
		if (settled) return;
		if (xhr.readyState < XMLHttpRequest.HEADERS_RECEIVED) return;
		if (xhr.status !== 200) {
			fail(new Error(`Daemon stream failed: HTTP ${xhr.status}`));
			return;
		}
		if (xhr.readyState === XMLHttpRequest.HEADERS_RECEIVED)
			callbacks.onOpen?.();
		if (
			xhr.readyState === XMLHttpRequest.LOADING ||
			xhr.readyState === XMLHttpRequest.DONE
		) {
			try {
				decoder.feed(xhr.responseText.slice(offset));
				offset = xhr.responseText.length;
				if (xhr.readyState === XMLHttpRequest.DONE) {
					decoder.finish();
					settled = true;
					callbacks.onEnd();
				}
			} catch (error) {
				fail(error instanceof Error ? error : new Error(String(error)));
			}
		}
	};
	xhr.onerror = () => fail(new Error("Daemon connection failed"));
	xhr.ontimeout = () => fail(new Error("Daemon connection timed out"));
	xhr.send(body === undefined ? undefined : JSON.stringify(body));
	return () => {
		settled = true;
		xhr.abort();
	};
}

export function subscribeEvents(
	http: DaemonHttp,
	callbacks: EventSubscription,
): () => void {
	let active = true;
	let cursor: string | undefined;
	let retries = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let abort: (() => void) | undefined;
	const retry = () => {
		callbacks.onStatus(false);
		if (!active || timer !== undefined) return;
		timer = setTimeout(
			() => {
				timer = undefined;
				connect();
			},
			Math.min(1000 * 2 ** retries++, 30_000),
		);
	};
	const connect = () => {
		if (!active) return;
		abort = streamSse(
			http,
			`/events${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`,
			{
				onOpen: () => {
					retries = 0;
					callbacks.onStatus(true);
				},
				onFrame: (frame) => {
					let payload: Record<string, unknown>;
					try {
						payload = decodeEventData(frame.data);
					} catch (error) {
						callbacks.onMalformed?.(
							frame.data,
							error instanceof Error ? error : new Error(String(error)),
						);
						return;
					}
					const timestamp =
						typeof payload.timestamp === "string"
							? payload.timestamp
							: undefined;
					if (frame.id !== undefined) cursor = frame.id;
					callbacks.onEvent({
						type: frame.event,
						payload,
						...(timestamp ? { timestamp } : {}),
					});
				},
				onEnd: retry,
				onError: (error) => {
					callbacks.onMalformed?.("", error);
					retry();
				},
			},
		);
	};
	connect();
	return () => {
		active = false;
		if (timer !== undefined) clearTimeout(timer);
		abort?.();
	};
}
