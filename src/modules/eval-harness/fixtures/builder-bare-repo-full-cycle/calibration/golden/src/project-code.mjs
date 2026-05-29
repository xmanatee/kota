export function normalizeProjectCode(input) {
  if (typeof input !== "string") {
    throw new TypeError("project code must be a string");
  }
  const normalized = input
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join("-");
  if (normalized.length === 0) {
    throw new TypeError("project code requires letters or digits");
  }
  return normalized;
}
