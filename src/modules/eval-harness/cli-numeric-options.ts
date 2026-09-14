/** CLI numbers use decimal notation only; exponents and radix prefixes reject. */
export function parseCliNumber(
  raw: string,
  name: string,
  domain: "positive integer" | "positive number" | "unit interval",
): number {
  const syntax = domain === "positive integer"
    ? /^\+?\d+$/
    : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
  const value = Number(raw);
  const inDomain = domain === "unit interval"
    ? value >= 0 && value <= 1
    : value > 0 && (domain !== "positive integer" || Number.isSafeInteger(value));
  if (raw.trim() !== raw || !syntax.test(raw) || !Number.isFinite(value) || !inDomain) {
    const expected = domain === "unit interval" ? "a number between 0 and 1"
      : domain === "positive integer" ? "a positive safe integer" : "a positive number";
    throw new Error(`--${name} must be ${expected} in decimal notation, got "${raw}".`);
  }
  return value;
}
