/**
 * Bound chunks by UTF-16 length without separating surrogate pairs in valid text.
 * Prefer the last newline at or before the limit, omitting that separator only.
 * Other whitespace is preserved. Limits must leave room for any Unicode scalar.
 */
export function segmentMessage(text: string, maxLength: number): string[] {
  if (!Number.isSafeInteger(maxLength) || maxLength < 2) {
    throw new RangeError("Message length limit must be a safe integer of at least 2");
  }
  if (text.length <= maxLength) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt <= 0) {
      splitAt = maxLength;
      const before = remaining.charCodeAt(splitAt - 1);
      const after = remaining.charCodeAt(splitAt);
      if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) {
        splitAt--;
      }
    }
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, "");
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
