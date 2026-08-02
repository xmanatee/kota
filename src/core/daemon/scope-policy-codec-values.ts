export type ScopePolicyBoundaryValue = unknown;
export type ScopePolicyBoundaryObject = { [key: string]: ScopePolicyBoundaryValue };

class DecodeFailure extends Error {}

export function optionalObject<T>(
  raw: ScopePolicyBoundaryValue,
  path: string,
  parse: (obj: ScopePolicyBoundaryObject, path: string) => T,
): T | undefined {
  return raw === undefined ? undefined : parse(objectValue(raw, path), path);
}

export function objectValue(
  raw: ScopePolicyBoundaryValue,
  path: string,
): ScopePolicyBoundaryObject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(`${path} must be an object`);
  }
  return raw as ScopePolicyBoundaryObject;
}

export function requiredString(raw: ScopePolicyBoundaryValue, path: string): string {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return raw;
}

export function positiveInteger(raw: ScopePolicyBoundaryValue, path: string): number {
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    fail(`${path} must be a positive integer`);
  }
  return raw;
}

export function stringArray(raw: ScopePolicyBoundaryValue, path: string): string[] {
  if (!Array.isArray(raw)) fail(`${path} must be an array`);
  return raw.map((entry, index) => requiredString(entry, `${path}[${index}]`));
}

export function enumArray<T extends string>(
  raw: ScopePolicyBoundaryValue,
  path: string,
  values: readonly T[],
): T[] {
  if (!Array.isArray(raw)) fail(`${path} must be an array`);
  const parsed = raw.map((entry, index) => requiredEnum(entry, `${path}[${index}]`, values));
  if (new Set(parsed).size !== parsed.length) fail(`${path} must not contain duplicates`);
  return parsed;
}

export function optionalEnum<T extends string>(
  raw: ScopePolicyBoundaryValue,
  path: string,
  values: readonly T[],
): T | undefined {
  return raw === undefined ? undefined : requiredEnum(raw, path, values);
}

export function requiredEnum<T extends string>(
  raw: ScopePolicyBoundaryValue,
  path: string,
  values: readonly T[],
): T {
  if (typeof raw !== "string" || !values.includes(raw as T)) {
    fail(`${path} must be one of ${values.join(", ")}`);
  }
  return raw as T;
}

export function assertKeys(
  obj: ScopePolicyBoundaryObject,
  path: string,
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(obj).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) fail(`${path} has unknown field ${unexpected[0]}`);
}

export function fail(message: string): never {
  throw new DecodeFailure(message);
}
