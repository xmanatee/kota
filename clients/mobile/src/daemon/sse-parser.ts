export interface SseFrame {
	event: string;
	data: string;
	id?: string;
}

/** Buffers lines and frames, including CRLF split across network chunks. */
export function createSseDecoder(emit: (frame: SseFrame) => void) {
	let pending = "";
	let event = "";
	let id: string | undefined;
	let data: string[] = [];
	return {
		feed(chunk: string) {
			pending += chunk;
			for (;;) {
				const separator = /\r\n|\r|\n/.exec(pending);
				if (
					!separator ||
					(separator[0] === "\r" && separator.index === pending.length - 1)
				)
					break;
				const line = pending.slice(0, separator.index);
				pending = pending.slice(separator.index + separator[0].length);
				if (line === "") {
					const frame = {
						event: event || "message",
						data: data.join("\n"),
						...(id !== undefined ? { id } : {}),
					};
					const dispatch = data.length > 0;
					event = "";
					data = [];
					if (dispatch) emit(frame);
				} else {
					const colon = line.indexOf(":");
					const field = colon < 0 ? line : line.slice(0, colon);
					const value =
						colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
					if (field === "event") event = value;
					if (field === "id" && !value.includes("\0")) id = value;
					if (field === "data") data.push(value);
				}
			}
		},
		finish() {
			if (pending.endsWith("\r")) this.feed("\n");
			if (pending.trim() || data.length > 0)
				throw new Error("Incomplete daemon event stream");
		},
	};
}
