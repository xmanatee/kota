import { z } from "zod";

// Reject controls before MIME construction; free-text bodies are not headers.
export const gmailHeaderValue = z.string().max(8_000).refine(
  // biome-ignore lint/suspicious/noControlCharactersInRegex: reject header injection controls
  (value) => !/[\r\n\x00-\x1f\x7f\u2028\u2029]/u.test(value),
  "Header values must not contain control characters or line breaks",
);
export const gmailResourceId = z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const parentSchema = z.object({
  id: gmailResourceId,
  threadId: gmailResourceId,
  payload: z.object({
    headers: z.array(z.object({ name: z.string().max(200), value: z.string().max(8_000) })).max(100),
  }),
});
// A conservative modern RFC message-id subset. Unsupported legacy syntax fails closed.
const atom = "[A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~]+";
const dotAtom = `${atom}(?:\\.${atom})*`;
const messageId = new RegExp(`^<${dotAtom}@(?:${dotAtom}|\\[[A-Za-z0-9:.]+\\])>$`);

export type GmailReplyParent = {
  id: string;
  threadId: string;
  subject: string;
  messageId: string;
  references: string[];
};

/** Only provider metadata supplies RFC identity; approval supplies the selected IDs. */
export function decodeGmailReplyParent(raw: unknown): GmailReplyParent | null {
  const parsed = parentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const headers = parsed.data.payload.headers;
  function one(name: string): string | undefined {
    const values = headers.filter((header) => header.name.toLowerCase() === name);
    if (values.length > 1) throw new Error("Ambiguous parent header");
    if (!values.length) return undefined;
    const unfolded = values[0].value.replace(/\r\n[ \t]+/g, " ");
    return gmailHeaderValue.parse(unfolded);
  }
  try {
    const subject = one("subject");
    const id = one("message-id")?.trim();
    if (subject === undefined || !id || !messageId.test(id)) return null;
    const references = one("references");
    const inReplyTo = one("in-reply-to");
    const ancestors = references !== undefined ? references.trim().split(/ +/) :
      inReplyTo && messageId.test(inReplyTo.trim()) ? [inReplyTo.trim()] : [];
    if (ancestors.some((value) => !messageId.test(value))) return null;
    return { id: parsed.data.id, threadId: parsed.data.threadId, subject, messageId: id, references: [...ancestors, id] };
  } catch {
    return null;
  }
}
