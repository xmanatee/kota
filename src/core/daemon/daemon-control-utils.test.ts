import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  RequestBodyTooLargeError,
  readBody,
} from "./daemon-control-utils.js";

function requestFromChunks(chunks: readonly Buffer[]): IncomingMessage {
  return Readable.from(chunks) as IncomingMessage;
}

describe("daemon control body reader", () => {
  it("returns the buffered request body while under the configured limit", async () => {
    const req = requestFromChunks([Buffer.from("he"), Buffer.from("llo")]);

    await expect(readBody(req, { limitBytes: 5 })).resolves.toEqual(Buffer.from("hello"));
  });

  it("rejects with an observable body-limit error status when the request exceeds the cap", async () => {
    const req = requestFromChunks([Buffer.from("abcd"), Buffer.from("efgh")]);

    await expect(readBody(req, { limitBytes: 4 })).rejects.toMatchObject({
      name: "RequestBodyTooLargeError",
      limitBytes: 4,
    });
    await expect(readBody(requestFromChunks([Buffer.from("abcde")]), { limitBytes: 4 }))
      .rejects
      .toBeInstanceOf(RequestBodyTooLargeError);
  });
});
