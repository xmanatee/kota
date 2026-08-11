import type { IncomingMessage, ServerResponse } from "node:http";

export type EvalJsonValue =
  | null
  | string
  | number
  | boolean
  | EvalJsonValue[]
  | EvalJsonObject;
export type EvalJsonObject = { [key: string]: EvalJsonValue };

export function isEvalJsonObject(
  value: EvalJsonValue | undefined,
): value is EvalJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function writeEvalJson(
  res: ServerResponse,
  status: number,
  body: object,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export async function readEvalJsonBody(
  req: IncomingMessage,
): Promise<EvalJsonValue> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((size, value) => size + value.length, 0) > 64 * 1024) {
      throw new Error("Request body too large for eval run (>64KB).");
    }
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  return text ? JSON.parse(text) : {};
}
