import { Buffer } from "node:buffer";

export function formatOpenAIHttpError(status: number, responseBody: string): Error {
	return new Error(
		`OpenAI API error ${status}: provider response body omitted (${Buffer.byteLength(
			responseBody,
			"utf-8",
		)} bytes)`,
	);
}
