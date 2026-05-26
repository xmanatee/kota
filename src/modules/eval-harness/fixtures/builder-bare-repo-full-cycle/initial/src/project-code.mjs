export function normalizeProjectCode(input) {
  if (typeof input !== "string") {
    throw new TypeError("project code must be a string");
  }
  return input.trim().toLowerCase().replace(/[\s_]+/g, "-");
}
