export function isSafeRunIdBasename(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    value === value.split(/[\\/]/).pop()
  );
}
