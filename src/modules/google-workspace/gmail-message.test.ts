import { describe, expect, it } from "vitest";
import { decodeGmailBody } from "./gmail-message.js";

const textPart = (text: string) => ({
  mimeType: "text/plain",
  body: { data: Buffer.from(text).toString("base64url"), size: Buffer.byteLength(text) },
});

describe("Gmail body interpretation", () => {
  it("reads a direct Unicode body and preserves an explicitly empty body", () => {
    for (const text of ["Delivery Thursday — café", ""]) {
      const result = decodeGmailBody(textPart(text));
      expect(result).toEqual({ status: "available", text, reasons: [], attachmentsExcluded: 0 });
    }
  });

  it("reads nested alternatives once and excludes named, explicit and container attachments", () => {
    const result = decodeGmailBody({
      mimeType: "multipart/mixed",
      parts: [
        { ...textPart("Old delivery Tuesday"), filename: "old.txt" },
        {
          mimeType: "multipart/alternative",
          parts: [
            { mimeType: "text/html", body: { data: Buffer.from("<p>Delivery Thursday</p>").toString("base64url") } },
            { mimeType: "multipart/mixed", parts: [textPart("Delivery Thursday")] },
            textPart("Delivery Thursday"),
          ],
        },
        { ...textPart("Old delivery Tuesday"), headers: [{ name: "CONTENT-DISPOSITION", value: "ATTACHMENT; filename=old.txt" }] },
        { mimeType: "multipart/mixed", filename: "forwarded.mime", parts: [textPart("Old delivery Tuesday")] },
      ],
    });
    expect(result).toEqual({ status: "available", text: "Delivery Thursday", reasons: [], attachmentsExcluded: 3 });
  });

  it.each([
    [{ mimeType: "text/plain", body: { attachmentId: "body-id", size: 20 } }, "stored separately"],
    [{ mimeType: "text/html", body: { data: "PHA-aGk8L3A-" } }, "Unsupported body content"],
    [{ mimeType: "text/plain", body: { data: "!!!" } }, "Malformed base64url"],
    [{ mimeType: "text/plain", body: { data: "a" } }, "Malformed base64url"],
    [{ mimeType: "text/plain", body: { data: "_w" } }, "Malformed UTF-8"],
    [{ mimeType: "text/plain", body: { data: "aGk", size: 3 } }, "size does not match"],
    [{ mimeType: "text/plain", body: { data: "aGk" }, headers: [{ name: "Content-Type", value: "text/plain; charset=iso-8859-1" }] }, "Unsupported body charset"],
    [{ mimeType: "text/plain", body: { data: 12 } }, "Malformed MIME"],
    [{ mimeType: "multipart/mixed", parts: "bad" }, "Malformed MIME"],
    [{ mimeType: "multipart/mixed", parts: [] }, "Malformed multipart"],
    [null, "Malformed MIME"],
    [{ ...textPart("Tuesday"), filename: "old.txt" }, "No supported message body"],
    [{ ...textPart("Tuesday"), headers: [{ name: "Content-Disposition", value: "inline; filename=old.txt" }] }, "No supported message body"],
  ])("reports why content is unavailable: %j", (payload, reason) => {
    const result = decodeGmailBody(payload);
    expect(result).toMatchObject({ status: "unavailable", text: null });
    expect(result.reasons.join(" ")).toContain(reason);
  });

  it("does not hide malformed alternatives behind a readable representation", () => {
    const result = decodeGmailBody({ mimeType: "multipart/alternative", parts: [textPart("Hello"), null] });
    expect(result.status).toBe("partial");
    expect(result.reasons.join(" ")).toContain("Malformed MIME");
  });

  it("bounds MIME depth and part count and reports omitted content", () => {
    let deep: unknown = textPart("Hidden body");
    for (let i = 0; i < 30; i++) deep = { mimeType: "multipart/mixed", parts: [deep] };
    const depthResult = decodeGmailBody(deep);
    expect(depthResult.status).toBe("unavailable");
    expect(depthResult.reasons.join(" ")).toContain("traversal limit");
    const wideResult = decodeGmailBody({ mimeType: "multipart/mixed", parts: Array.from({ length: 300 }, () => textPart("segment")) });
    expect(wideResult.status).toBe("partial");
    expect(wideResult.reasons.join(" ")).toContain("traversal limit");
    expect(wideResult.text?.match(/segment/g)?.length).toBeLessThan(300);
  });

  it("labels decoding and rendered output limits", () => {
    const unavailable = decodeGmailBody(textPart("x".repeat(60_000)));
    expect(unavailable.reasons.join(" ")).toContain("Body decoding limit exceeded");
    expect(unavailable.status).toBe("unavailable");
    const partial = decodeGmailBody(textPart("x".repeat(40_000)));
    expect(partial.status).toBe("partial");
    expect(partial.reasons.join(" ")).toContain("Body truncated by output limit");
    expect(partial.text).toHaveLength(32_000);
  });
});
