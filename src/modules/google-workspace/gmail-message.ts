import { z } from "zod";
import type { ToolResult } from "#core/tools/tool-result.js";

const MAX_PARTS = 200;
const MAX_DEPTH = 20;
const MAX_BODY_CHARS = 32_000;
const MAX_ENCODED_BYTES = 64_000;
const headerSchema = z.object({ name: z.string().max(200), value: z.string().max(8_000) });
// Decode one level at a time: a recursive schema would traverse before our budget applies.
const partSchema = z.object({
  mimeType: z.string().min(1).max(200),
  filename: z.string().max(8_000).optional(),
  headers: z.array(headerSchema).max(100).optional(),
  body: z.object({
    data: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    attachmentId: z.string().min(1).optional(),
  }).optional(),
  parts: z.custom<unknown[]>(Array.isArray).optional(),
});
const messageSchema = z.object({
  id: z.string().min(1),
  snippet: z.string().optional(),
  payload: z.unknown().optional(),
});
type Part = z.infer<typeof partSchema>;
type Body = { text: string | null; reasons: string[] };
const unavailable = (reason: string): Body => ({ text: null, reasons: [reason] });
const header = (part: Part, name: string): string | undefined =>
  part.headers?.find((h) => h.name.toLowerCase() === name)?.value;

export type GmailBody = { attachmentsExcluded: number } & (
  | { status: "available"; text: string; reasons: [] }
  | { status: "partial"; text: string; reasons: string[] }
  | { status: "unavailable"; text: null; reasons: string[] }
);

/** Interpret Gmail MIME once for reading and inbound automation; never read attachments. */
export function decodeGmailBody(payload: unknown): GmailBody {
  let visited = 0;
  let attachments = 0;
  const structuralIssues = new Set<string>();
  function read(rawPart: unknown, depth: number): Body {
    visited++;
    if (depth > MAX_DEPTH || visited > MAX_PARTS) {
      structuralIssues.add("MIME traversal limit reached; some content was not inspected.");
      return unavailable("MIME traversal limit reached.");
    }
    const decoded = partSchema.safeParse(rawPart);
    if (!decoded.success) {
      structuralIssues.add("Malformed MIME part or header limits exceeded.");
      return unavailable("Malformed MIME part or header limits exceeded.");
    }
    const part = decoded.data;
    const disposition = header(part, "content-disposition") ?? "";
    const contentType = header(part, "content-type") ?? "";
    if (
      part.filename?.trim() || /^\s*attachment(?:\s*;|\s*$)/i.test(disposition) ||
      /;\s*filename\*?\s*=/i.test(disposition) || /;\s*name\*?\s*=/i.test(contentType)
    ) {
      attachments++;
      return { text: null, reasons: [] };
    }
    const mime = part.mimeType.toLowerCase();
    if (mime === "multipart/mixed" || mime === "multipart/alternative") {
      if (!part.parts?.length || part.body?.data || part.body?.attachmentId) {
        structuralIssues.add("Malformed multipart body.");
        return unavailable("Malformed multipart body.");
      }
      const children: Body[] = [];
      for (const child of part.parts) {
        if (visited >= MAX_PARTS) {
          structuralIssues.add("MIME traversal limit reached; some content was not inspected.");
          break;
        }
        children.push(read(child, depth + 1));
      }
      // Alternative children describe the same content: prefer one complete readable version.
      if (mime === "multipart/alternative") {
        const selected = children.find((c) => c.text !== null && c.reasons.length === 0) ??
          children.find((c) => c.text !== null);
        if (selected) return selected;
      }
      const texts = children.flatMap((c) => c.text === null ? [] : [c.text]);
      return {
        text: texts.length ? texts.join("\n\n") : null,
        reasons: children.flatMap((c) => c.reasons),
      };
    }
    if (part.parts?.length) {
      if (!mime.startsWith("multipart/")) structuralIssues.add("Malformed non-container MIME part.");
      return unavailable(`Unsupported MIME container: ${mime}.`);
    }
    if (mime !== "text/plain") return unavailable(`Unsupported body content: ${mime}.`);
    const charset = /;\s*charset\s*=\s*(?:"([^"]*)"|([^;\s]*))/i.exec(contentType);
    const encoding = (charset?.[1] ?? charset?.[2] ?? "utf-8").toLowerCase();
    if (!["utf-8", "utf8", "us-ascii"].includes(encoding)) {
      return unavailable("Unsupported body charset.");
    }
    const body = part.body;
    if (body?.attachmentId) {
      return unavailable("Body is stored separately; its bytes were not fetched.");
    }
    if (!body || (body.data === undefined && body.size !== 0)) {
      return unavailable("Body bytes are missing.");
    }
    const data = body.data ?? "";
    if (data.length > MAX_ENCODED_BYTES) return unavailable("Body decoding limit exceeded.");
    if (!/^[A-Za-z0-9_-]*={0,2}$/.test(data)) return unavailable("Malformed base64url body.");
    const bytes = Buffer.from(data, "base64url");
    if (bytes.toString("base64url") !== data.replace(/=+$/, "") ||
      (data.includes("=") && data.length % 4 !== 0)) {
      return unavailable("Malformed base64url body.");
    }
    if (body.size !== undefined && body.size !== bytes.length) {
      return unavailable("Body size does not match available bytes.");
    }
    if (encoding === "us-ascii" && bytes.some((byte) => byte > 127)) {
      return unavailable("Malformed ASCII body.");
    }
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), reasons: [] };
    } catch {
      return unavailable("Malformed UTF-8 body.");
    }
  }

  const body = read(payload, 0);
  const reasons = new Set([...structuralIssues, ...body.reasons]);
  if (body.text === null && reasons.size === 0) reasons.add("No supported message body found.");
  if (body.text !== null && body.text.length > MAX_BODY_CHARS) {
    reasons.add("Body truncated by output limit.");
  }
  const attachmentsExcluded = attachments;
  if (body.text === null) {
    return { status: "unavailable", text: null, reasons: [...reasons], attachmentsExcluded };
  }
  const text = body.text.slice(0, MAX_BODY_CHARS);
  return reasons.size
    ? { status: "partial", text, reasons: [...reasons], attachmentsExcluded }
    : { status: "available", text, reasons: [], attachmentsExcluded };
}

/** Tool presentation is separate from body interpretation and inbound presentation. */
export function gmailMessageResult(raw: unknown): ToolResult {
  const message = messageSchema.safeParse(raw);
  if (!message.success) {
    return { content: "Message body unavailable: malformed Gmail message response.", is_error: true };
  }
  const body = decodeGmailBody(message.data.payload);
  const reasons = new Set(body.reasons);
  const root = partSchema.safeParse(message.data.payload);
  const metadata = ["subject", "from", "reply-to", "to", "cc", "date"].map((name) => {
    const value = root.success ? header(root.data, name) ?? "" : "";
    if (value.length > 2_000) reasons.add("Message headers truncated by output limit.");
    return `${name[0].toUpperCase()}${name.slice(1)}: ${value.slice(0, 2_000)}`;
  });
  const status = body.text === null ? "Message body unavailable" :
    reasons.size ? "Message body partial" : "Message body (plain text)";
  const lines = [...metadata, "", `${status}${reasons.size ? `: ${[...reasons].join(" ")}` : ":"}`];
  if (body.text !== null) lines.push(body.text);
  else if (message.data.snippet !== undefined) {
    const snippet = message.data.snippet;
    lines.push(`Snippet fallback (excerpt only${snippet.length > 2_000 ? "; truncated" : ""}):`, snippet.slice(0, 2_000));
  }
  if (body.attachmentsExcluded) lines.push(`\nAttachments excluded from body: ${body.attachmentsExcluded} (contents not read).`);
  return { content: lines.join("\n"), ...(body.text === null ? { is_error: true } : {}) };
}
