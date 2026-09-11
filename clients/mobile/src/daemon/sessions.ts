import { decodeEventData, streamSse } from "./sse";
import { daemonResponse, type DaemonHttp } from "./http";

export async function deleteSession(
	http: DaemonHttp,
	id: string,
): Promise<void> {
	const response = await daemonResponse(
		http,
		`/sessions/${encodeURIComponent(id)}`,
		{ method: "DELETE" },
	);
	if (!response.ok && response.status !== 404) {
		throw new Error(`${response.status} ${response.statusText}`);
	}
}

export function streamChat(
	http: DaemonHttp,
	sessionId: string,
	message: string,
	onText: (chunk: string) => void,
	onDone: () => void,
	onError: (error: string) => void,
): () => void {
	let finished = false;
	const fail = (error: Error) => {
		if (!finished) {
			finished = true;
			onError(error.message);
		}
	};
	return streamSse(
		http,
		`/sessions/${encodeURIComponent(sessionId)}/chat`,
		{
			onFrame: (frame) => {
				if (finished) return;
				const payload = decodeEventData(frame.data);
				if (frame.event === "text") {
					if (typeof payload.content !== "string")
						throw new Error("Invalid chat text event");
					onText(payload.content);
				} else if (frame.event === "done") {
					finished = true;
					onDone();
					} else if (frame.event === "error") {
						throw new Error(
							typeof payload.message === "string" ? payload.message : "Chat failed",
						);
				}
			},
			onEnd: () => {
				if (!finished) fail(new Error("Chat stream ended before completion"));
			},
			onError: fail,
		},
		{ message },
	);
}
