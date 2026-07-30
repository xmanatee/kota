import type { IncomingMessage } from "node:http";
import type { KotaJsonObject } from "#core/agent-harness/message-protocol.js";

/** Read the HTTP request body as a parsed JSON object (max 1MB). */
export function readChatBody(req: IncomingMessage): Promise<KotaJsonObject> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const maxBodyBytes = 1024 * 1024;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        req.destroy();
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text ? (JSON.parse(text) as KotaJsonObject) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
